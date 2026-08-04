 import type { AssistantIntent } from '@fpl/types';
import type {
  RecommendationContextBlock,
  CaptainCandidateSummary,
  PlayerComparisonSimpleResult,
  TransferEvaluationResult,
} from './recommendation.types.js';
import { getCaptainRecommendations }  from './captaincy.service.js';
import { compareMentionedPlayers }    from './player-comparison.service.js';
import { evaluateMentionedTransfer }  from './transfer-evaluator.service.js';
import {
  projectCaptainOptions,
  projectTransferDelta,
}                                     from './projection.service.js';
import {
  formatCaptainProjection,
  formatTransferDelta,
  formatPlayerProjection,
}                                     from './projection.formatter.js';
import {
  buildSquadIntelligence,
  analyseWeakLinks,
  optimiseLineup,
  optimiseBenchOrder,
  recommendFormation,
}                                     from './squad-intelligence.engine.js';
import {
  formatForIntent,
  formatLineupOptimization,
  formatFormationRecommendation,
  formatBenchOrder,
  formatWeakLinks,
}                                     from './squad-intelligence.formatter.js';
import { findMentionedPlayers }       from './player-search.service.js';
import { getEditableGameweekId }      from '../../utils/gameweek.js';
import { prisma }                     from '../../db/prisma.js';
import {
  buildMlRecommendationBlock,
  type MlRecommendationBlock,
}                                     from './ml-recommendation-engine.service.js';



export type { MlRecommendationBlock };



export interface RecommendationResult {
  intent:     AssistantIntent;
  summary:    string;
  structured: Record<string, unknown> | null;
  mlBlock:    MlRecommendationBlock | null;
  conflictResolution: ConflictResolution;
}



export type ConflictSource = 'ML' | 'HEURISTIC' | 'ML_ONLY' | 'HEURISTIC_ONLY';

export interface ConflictResolution {
  primarySource: ConflictSource;
  reason:        string;
}

const ML_PRIMARY_INTENTS: ReadonlySet<AssistantIntent> = new Set([
  'CAPTAINCY',
  'TRANSFER_ADVICE',
  'TRANSFER_EVALUATION',
  'PLAYER_COMPARISON',
  'INITIAL_SQUAD',
  'GENERAL_HELP',
]);

function resolveConflict(intent: AssistantIntent, mlAvailable: boolean): ConflictResolution {
  if (!mlAvailable) {
    return { primarySource: 'HEURISTIC_ONLY', reason: 'ML predictions unavailable for this gameweek/intent — using rule-based engine only.' };
  }
  if (ML_PRIMARY_INTENTS.has(intent)) {
    return { primarySource: 'ML', reason: `${intent} is primarily score-driven — ML predictions (trained, time-series validated) take precedence over heuristic weighting.` };
  }
  return { primarySource: 'HEURISTIC', reason: `${intent} is primarily rule/constraint-driven (formation validity, chip-usage rules) — heuristic engine takes precedence, ML used as supporting signal.` };
}

function conflictInstruction(resolution: ConflictResolution): string {
  switch (resolution.primarySource) {
    case 'ML':
      return 'INSTRUCTION: The ML block above is PRIMARY for this answer. Lead with its ranking/score. Use the rule-based section only as supporting context, and explicitly flag it if the two disagree.';
    case 'HEURISTIC':
      return 'INSTRUCTION: The rule-based section below is PRIMARY for this answer (formation/chip validity rules). Use the ML block only as supporting signal (e.g. which player to prioritise within a valid option), and flag it if they disagree.';
    case 'HEURISTIC_ONLY':
      return 'INSTRUCTION: No ML data is available for this request — base the answer entirely on the rule-based section below and say so if asked about model-based projections.';
    case 'ML_ONLY':
      return 'INSTRUCTION: Base the answer entirely on the ML block above.';
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCost(tenths: number): string {
  return `£${(tenths / 10).toFixed(1)}m`;
}

function joinBlocks(...blocks: string[]): string {
  return blocks.filter((b) => b.trim().length > 0).join('\n\n');
}

async function getSquadPlayerIds(userId: string, gameweek: number): Promise<number[]> {
  const team = await prisma.userTeam.findUnique({
    where:  { userId },
    select: { id: true },
  });
  if (!team) return [];
  const picks = await prisma.userPick.findMany({
    where:  { userTeamId: team.id, gameweek },
    select: { playerId: true },
  });
  return picks.map((p) => p.playerId);
}



function formatCaptainSummary(
  candidates:      CaptainCandidateSummary[],
  projectionBlock: string,
): string {
  const lines: string[] = ['=== CAPTAINCY ANALYSIS (rule-based) ===', ''];

  if (projectionBlock) { lines.push(projectionBlock); lines.push(''); }

  if (candidates.length > 0) {
    lines.push('Composite scoring (form × fixture × availability):', '');
    candidates.forEach((c, i) => {
      const riskText = c.risk.length ? c.risk.join('; ') : 'none identified';
      lines.push(`${i + 1}. ${c.webName} (${c.club}, ${c.position})`);
      lines.push(`   Score:       ${c.score}`);
      lines.push(`   Reasons:     ${c.reasons.join('; ') || 'general consistency'}`);
      lines.push(`   Risks:       ${riskText}`);
      lines.push(`   Upside:      ${c.explanation.upside}`);
      lines.push(`   Horizon:     ${c.explanation.horizon}`);
      lines.push(`   Alternative: ${c.explanation.alternative}`);
      lines.push(`   Confidence:  ${c.explanation.confidence}`);
      lines.push('');
    });
  }

  return lines.join('\n');
}

function formatComparisonSummary(result: PlayerComparisonSimpleResult): string {
  if (!result.found || result.players.length < 2) {
    return [
      '=== PLAYER COMPARISON ===',
      result.recommendation ?? 'Could not identify two players to compare.',
      'Ask the manager to clarify which players they want to compare.',
    ].join('\n');
  }

  const [a, b] = result.players;
  const lines: string[] = ['=== PLAYER COMPARISON (rule-based) ===', ''];

  for (const [label, p] of [['Player A', a], ['Player B', b]] as const) {
    lines.push(`${label}: ${p.webName} (${p.club}, ${p.position})`);
    lines.push(`  Price:        ${fmtCost(p.nowCost)}`);
    lines.push(`  Total points: ${p.totalPoints}`);
    lines.push(`  Form:         ${p.form !== null ? p.form.toFixed(1) : 'N/A'}`);
    lines.push(`  Availability: ${p.chanceOfPlayingNextRound !== null && p.chanceOfPlayingNextRound < 100 ? `${p.chanceOfPlayingNextRound}% chance` : 'Fit'}`);
    lines.push(`  Status:       ${p.status !== 'a' ? `⚠️  ${p.status.toUpperCase()}` : 'Available'}`);
    if (p.pros.length) lines.push(`  Pros: ${p.pros.join('; ')}`);
    if (p.cons.length) lines.push(`  Cons: ${p.cons.join('; ')}`);
    lines.push('');
  }

  const priceDiff = Math.abs(a.nowCost - b.nowCost);
  if (priceDiff > 0) {
    const cheaper = a.nowCost < b.nowCost ? a.webName : b.webName;
    const pricier = a.nowCost < b.nowCost ? b.webName : a.webName;
    lines.push(`Price gap: ${fmtCost(priceDiff)} — ${cheaper} is cheaper, ${pricier} is more expensive.`);
    lines.push('');
  }

  lines.push(`COMPUTED VERDICT: ${result.recommendation}`);
  return lines.join('\n');
}

function formatTransferSummary(
  result:          TransferEvaluationResult,
  projectionBlock: string,
  weakLinksBlock:  string,
): string {
  if (!result.detected) {
    return joinBlocks(
      [
        '=== TRANSFER EVALUATION ===',
        result.recommendation ?? 'Could not identify a specific transfer from the message.',
        "Provide general transfer advice based on the manager's squad, bank, and free transfers.",
      ].join('\n'),
      weakLinksBlock,
    );
  }

  const lines: string[] = ['=== TRANSFER EVALUATION (rule-based checks) ===', ''];

  if (projectionBlock) { lines.push(projectionBlock); lines.push(''); }

  lines.push('RULE & BUDGET CHECKS:');
  if (result.outgoingPlayer) {
    const out = result.outgoingPlayer;
    lines.push(
      `  OUT: ${out.webName} (${out.club}, ${out.position})` +
      `${out.sellPrice !== undefined ? ` — sell: ${fmtCost(out.sellPrice)}` : ''}`,
    );
  }
  if (result.incomingPlayer) {
    const inc = result.incomingPlayer;
    lines.push(`  IN:  ${inc.webName} (${inc.club}, ${inc.position}) — buy: ${fmtCost(inc.buyPrice)}`);
    if (inc.chanceOfPlayingNextRound !== null && inc.chanceOfPlayingNextRound < 100)
      lines.push(`  ⚠️  ${inc.chanceOfPlayingNextRound}% chance of playing`);
    if (inc.status !== 'a') lines.push(`  ⚠️  Status: ${inc.status.toUpperCase()}`);
  }
  if (result.budgetImpact) {
    const bi = result.budgetImpact;
    lines.push(`  Bank after: ${fmtCost(bi.bankAfter)}  ${bi.affordable ? '✓' : '✗ NOT AFFORDABLE'}`);
  }
  if (result.ruleCheck) {
    const rc = result.ruleCheck;
    lines.push(`  Same position: ${rc.samePosition ? 'Yes ✓' : 'NO ✗ — mismatch'}`);
    lines.push(`  Club limit:    ${rc.maxPerClubLikelyOk ? 'OK ✓' : 'MAY BREAK 3-per-club ✗'}`);
  }
  if (result.risks?.length) lines.push('  Risks: ' + result.risks.join('; '));

  lines.push('');
  lines.push(`VERDICT: ${result.recommendation}`);

  if (weakLinksBlock) { lines.push(''); lines.push(weakLinksBlock); }

  return lines.join('\n');
}

// ── Main orchestrator ─────────────────────────────────────────────────────────

export async function buildRecommendationContext(params: {
  userId:  string;
  intent:  AssistantIntent;
  message: string;
}): Promise<RecommendationResult | null> {
  const { userId, intent, message } = params;

  try {
    const gameweek = await getEditableGameweekId();
    const squadIds = await getSquadPlayerIds(userId, gameweek);

    switch (intent) {

      // ── CAPTAINCY ──────────────────────────────────────────────────────────
      case 'CAPTAINCY': {
        const [candidates, captainProj, mlBlock] = await Promise.all([
          getCaptainRecommendations(userId),
          projectCaptainOptions(userId),
          buildMlRecommendationBlock({ userId, intent, squadPlayerIds: squadIds, gameweek }),
        ]);

        const resolution = resolveConflict(intent, mlBlock.available);
        const projBlock        = captainProj ? formatCaptainProjection(captainProj) : '';
        const heuristicSummary = formatCaptainSummary(candidates, projBlock);

        return {
          intent,
          summary: joinBlocks(
            mlBlock.available ? mlBlock.promptBlock : '',
            heuristicSummary,
            conflictInstruction(resolution),
          ),
          structured: {
            candidates,
            projection:  captainProj,
            mlStructured: mlBlock.structured ?? null,
          } as Record<string, unknown>,
          mlBlock,
          conflictResolution: resolution,
        };
      }

      // ── PLAYER COMPARISON ──────────────────────────────────────────────────
      case 'PLAYER_COMPARISON': {
        const mentioned  = await findMentionedPlayers(message, 4);
        const mentionedIds = mentioned.map((p) => p.id);

        const [compResult, mlBlock] = await Promise.all([
          compareMentionedPlayers(message),
          buildMlRecommendationBlock({
            userId,
            intent,
            squadPlayerIds:    squadIds,
            gameweek,
            mentionedPlayerIds: mentionedIds,
          }),
        ]);

        const resolution = resolveConflict(intent, mlBlock.available);

        let heuristicProjectionLines = '';
        if (mentioned.length >= 2) {
          const [rawA, rawB] = await Promise.all([
            prisma.fplPlayer.findUnique({ where: { id: mentioned[0].id }, include: { team: true } }),
            prisma.fplPlayer.findUnique({ where: { id: mentioned[1].id }, include: { team: true } }),
          ]);
          if (rawA && rawB) {
            const { projectPlayer } = await import('./projection.service.js');
            const [projA, projB] = await Promise.all([
              projectPlayer(rawA, gameweek),
              projectPlayer(rawB, gameweek),
            ]);
            heuristicProjectionLines = joinBlocks(
              formatPlayerProjection(projA),
              formatPlayerProjection(projB),
            );
          }
        }

        return {
          intent,
          summary: joinBlocks(
            mlBlock.available ? mlBlock.promptBlock : '',
            heuristicProjectionLines,
            formatComparisonSummary(compResult),
            conflictInstruction(resolution),
          ),
          structured: {
            comparison:  compResult,
            mlStructured: mlBlock.structured ?? null,
          } as Record<string, unknown>,
          mlBlock,
          conflictResolution: resolution,
        };
      }

      // ── TRANSFER ───────────────────────────────────────────────────────────
      case 'TRANSFER_EVALUATION':
      case 'TRANSFER_ADVICE': {
        const team    = await prisma.userTeam.findUnique({ where: { userId }, select: { id: true } });
        const gwState = team
          ? await prisma.userGameweekState.findUnique({
              where: { userTeamId_gameweek: { userTeamId: team.id, gameweek } },
            })
          : null;
        const freeTransfers = gwState?.freeTransfers ?? 1;

        const transferResult = await evaluateMentionedTransfer(userId, message);
        const outId = transferResult.outgoingPlayer?.playerId ?? null;
        const inId  = transferResult.incomingPlayer?.playerId ?? null;

        const [weakLinksData, projDelta, mlBlock] = await Promise.all([
          analyseWeakLinks(userId),
          transferResult.detected && outId && inId
            ? projectTransferDelta(outId, inId, freeTransfers, 0)
            : Promise.resolve(null),
          buildMlRecommendationBlock({ userId, intent, squadPlayerIds: squadIds, gameweek }),
        ]);

        const resolution  = resolveConflict(intent, mlBlock.available);
        const projBlock    = projDelta ? formatTransferDelta(projDelta) : '';
        const weakBlock    = weakLinksData ? formatWeakLinks(weakLinksData) : '';

        return {
          intent,
          summary: joinBlocks(
            mlBlock.available ? mlBlock.promptBlock : '',
            formatTransferSummary(transferResult, projBlock, weakBlock),
            conflictInstruction(resolution),
          ),
          structured: {
            transfer:    transferResult,
            mlStructured: mlBlock.structured ?? null,
          } as Record<string, unknown>,
          mlBlock,
          conflictResolution: resolution,
        };
      }

      // ── FORMATION ADVICE ───────────────────────────────────────────────────
      case 'FORMATION_ADVICE': {
        const [formationRec, lineupOpt, mlBlock] = await Promise.all([
          recommendFormation(userId),
          optimiseLineup(userId),
          buildMlRecommendationBlock({ userId, intent, squadPlayerIds: squadIds, gameweek }),
        ]);
        if (!formationRec) return null;

        const resolution = resolveConflict(intent, mlBlock.available);
        const parts: string[] = [];
        if (mlBlock.available)  parts.push(mlBlock.promptBlock);
        parts.push(formatFormationRecommendation(formationRec));
        if (lineupOpt)          parts.push(formatLineupOptimization(lineupOpt));
        parts.push(conflictInstruction(resolution));

        return {
          intent,
          summary:    joinBlocks(...parts),
          structured: { formation: formationRec, mlStructured: mlBlock.structured ?? null } as Record<string, unknown>,
          mlBlock,
          conflictResolution: resolution,
        };
      }

      // ── BENCH ORDER ────────────────────────────────────────────────────────
      case 'BENCH_ORDER': {
        const [benchRec, mlBlock] = await Promise.all([
          optimiseBenchOrder(userId),
          buildMlRecommendationBlock({ userId, intent, squadPlayerIds: squadIds, gameweek }),
        ]);
        if (!benchRec) return null;

        const resolution = resolveConflict(intent, mlBlock.available);

        return {
          intent,
          summary: joinBlocks(
            mlBlock.available ? mlBlock.promptBlock : '',
            formatBenchOrder(benchRec),
            conflictInstruction(resolution),
          ),
          structured: { benchOrder: benchRec, mlStructured: mlBlock.structured ?? null } as Record<string, unknown>,
          mlBlock,
          conflictResolution: resolution,
        };
      }

      // ── GENERAL HELP / INITIAL SQUAD ───────────────────────────────────────
      case 'GENERAL_HELP':
      case 'INITIAL_SQUAD': {
        const [intel, mlBlock] = await Promise.all([
          buildSquadIntelligence(userId),
          buildMlRecommendationBlock({ userId, intent, squadPlayerIds: squadIds, gameweek }),
        ]);
        if (!intel) return null;

        const resolution = resolveConflict(intent, mlBlock.available);

        return {
          intent,
          summary: joinBlocks(
            mlBlock.available ? mlBlock.promptBlock : '',
            formatForIntent(intel, intent),
            conflictInstruction(resolution),
          ),
          structured: { mlStructured: mlBlock.structured ?? null } as Record<string, unknown>,
          mlBlock,
          conflictResolution: resolution,
        };
      }

      // ── CHIP ADVICE ────────────────────────────────────────────────────────
      case 'CHIP_ADVICE': {
        const [lineupOpt, weakLinksData, mlBlock] = await Promise.all([
          optimiseLineup(userId),
          analyseWeakLinks(userId),
          buildMlRecommendationBlock({ userId, intent, squadPlayerIds: squadIds, gameweek }),
        ]);

        const resolution = resolveConflict(intent, mlBlock.available);
        const parts: string[] = [];
        if (mlBlock.available)  parts.push(mlBlock.promptBlock);
        if (lineupOpt)          parts.push(formatLineupOptimization(lineupOpt));
        if (weakLinksData)      parts.push(formatWeakLinks(weakLinksData));
        if (parts.length === 0) return null;

        parts.push(
          [
            'Use the ML chip assessment and lineup context above to time chip usage.',
            'High ML projected score + strong captain candidate → Bench Boost / TC window.',
            'Multiple rotation risks or weak links → consider Free Hit reset.',
            'Always verify chip availability in the manager context before recommending.',
          ].join('\n'),
        );
        parts.push(conflictInstruction(resolution));

        return {
          intent,
          summary: joinBlocks(...parts),
          structured: { mlStructured: mlBlock.structured ?? null } as Record<string, unknown>,
          mlBlock,
          conflictResolution: resolution,
        };
      }

      default:
        return null;
    }
  } catch (err) {
    console.error('[RecommendationService] Failed to build context:', err);
    return null;
  }
}
