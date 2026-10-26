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
import {
  optimizeInitialSquad,
  formatOptimisedSquadForPrompt,
}                                     from './squad-optimizer.service.js';
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

/**
 * Shared no-existing-squad fallback for GENERAL_HELP and INITIAL_SQUAD.
 *
 * buildSquadIntelligence has nothing to work from for a user with no team
 * yet (it's built for improving an existing squad, not building one from
 * scratch) — both intents used to fall straight to `return null` in that
 * case, leaving the LLM with zero real player data and no way to honor
 * "don't invent players not in the data" when no data was given. It fell
 * back on its own (stale, sometimes years out of date) knowledge instead.
 *
 * GENERAL_HELP needs this too, not just INITIAL_SQUAD: the intent
 * classifier is keyword-based, and plenty of natural phrasings for "help me
 * build a squad" (e.g. "help me choose forwards") don't match any specific
 * rule and land in GENERAL_HELP, the catch-all bucket. Any of those, for a
 * user with no team, needs the same real grounding.
 */
const POOL_SIZE_DEFAULT = 30;
const POOL_SIZE_MIN     = 5;
const POOL_SIZE_MAX     = 60;

/**
 * How many players the initial-squad candidate pool should hold — read from
 * an explicit number in the user's message ("recommend 40 players"), a bare
 * "more"/"fewer" ask relative to the default, or just POOL_SIZE_DEFAULT.
 */
function extractPoolSize(message: string): number {
  const near = message.match(/(\d{1,3})\s*(?:players?|picks?|candidates?|options?)/i);
  const bare = message.match(/\b(\d{1,3})\b/);
  const n = near ? parseInt(near[1], 10) : bare ? parseInt(bare[1], 10) : null;
  if (n !== null && n >= POOL_SIZE_MIN && n <= POOL_SIZE_MAX) return n;

  if (/\b(more|bigger|wider|longer|extra)\b/i.test(message)) {
    return Math.min(POOL_SIZE_MAX, POOL_SIZE_DEFAULT + 15);
  }
  if (/\b(less|fewer|smaller|shorter)\b/i.test(message)) {
    return Math.max(POOL_SIZE_MIN, POOL_SIZE_DEFAULT - 15);
  }
  return POOL_SIZE_DEFAULT;
}

async function buildNoSquadFallback(
  intent: AssistantIntent,
  userId: string,
  message: string,
): Promise<RecommendationResult> {
  const optimized = await optimizeInitialSquad({ userId, poolSize: extractPoolSize(message) });
  if (optimized.status !== 'OPTIMAL') {
    console.error(
      `[RecommendationService] Initial squad optimizer returned ${optimized.status}: ` +
      `${optimized.reason ?? 'no reason given'}`,
    );
  }

  return {
    intent,
    summary: formatOptimisedSquadForPrompt(optimized),
    structured: { optimizedSquad: optimized } as Record<string, unknown>,
    mlBlock: null,
    conflictResolution: {
      primarySource: 'ML_ONLY',
      reason: 'No existing squad to analyse — built directly from the ML-driven budget optimizer.',
    },
  };
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

function formatPlayerStatBlock(label: string, p: PlayerComparisonSimpleResult['players'][number]): string[] {
  const lines: string[] = [];
  lines.push(`${label}: ${p.webName} (${p.club}, ${p.position})`);
  lines.push(`  Price:        ${fmtCost(p.nowCost)}`);
  lines.push(`  Total points: ${p.totalPoints}`);
  lines.push(`  Goals:        ${p.goalsScored}`);
  lines.push(`  Assists:      ${p.assists}`);
  if (p.position === 'GK' || p.position === 'DEF') {
    lines.push(`  Clean sheets: ${p.cleanSheets}`);
  }
  lines.push(`  Bonus points: ${p.bonus}`);
  lines.push(`  Minutes:      ${p.minutes}`);
  lines.push(`  Form:         ${p.form !== null ? p.form.toFixed(1) : 'N/A'}`);
  lines.push(`  Availability: ${p.chanceOfPlayingNextRound !== null && p.chanceOfPlayingNextRound < 100 ? `${p.chanceOfPlayingNextRound}% chance` : 'Fit'}`);
  lines.push(`  Status:       ${p.status !== 'a' ? `⚠️  ${p.status.toUpperCase()}` : 'Available'}`);
  if (p.pros.length) lines.push(`  Pros: ${p.pros.join('; ')}`);
  if (p.cons.length) lines.push(`  Cons: ${p.cons.join('; ')}`);
  return lines;
}

function formatComparisonSummary(result: PlayerComparisonSimpleResult): string {
  if (!result.found || result.players.length === 0) {
    return [
      '=== PLAYER LOOKUP ===',
      result.recommendation ?? 'Could not identify a player from the message.',
      'Ask the manager to clarify which player(s) they mean.',
    ].join('\n');
  }

  // Exactly one player named → a profile, not a comparison. No "Player A"
  // framing, no verdict to force — there's nothing to compare against.
  if (result.players.length === 1) {
    const lines: string[] = [
      '=== PLAYER PROFILE (rule-based) ===',
      '',
      ...formatPlayerStatBlock('Player', result.players[0]),
      '',
      'INSTRUCTION: Present these season stats and pros/cons directly — do not',
      'invent a comparison against a player the user did not name.',
    ];
    return lines.join('\n');
  }

  const [a, b] = result.players;
  const lines: string[] = ['=== PLAYER COMPARISON (rule-based) ===', ''];

  lines.push(...formatPlayerStatBlock('Player A', a), '');
  lines.push(...formatPlayerStatBlock('Player B', b), '');

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

// ── Player comparison / single-player profile ──────────────────────────────────
//
// Shared by the PLAYER_COMPARISON intent AND the GENERAL_HELP fallback: a
// message that's just player names ("Saka?", "Rogers or Havertz") often
// scores no CAPTAINCY/TRANSFER/etc keyword and lands in GENERAL_HELP, but the
// user clearly wants stats on those specific players, not generic squad
// advice. Both paths build the same grounded block.

async function buildPlayerComparisonResult(
  userId:   string,
  intent:   AssistantIntent,
  message:  string,
  gameweek: number,
  squadIds: number[],
): Promise<RecommendationResult> {
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
  if (mentioned.length >= 1) {
    const targets = mentioned.slice(0, 2);
    const raws = await Promise.all(
      targets.map((m) =>
        prisma.fplPlayer.findUnique({ where: { id: m.id }, include: { team: true } }),
      ),
    );
    const found = raws.filter((r): r is NonNullable<typeof r> => r !== null);
    if (found.length > 0) {
      const { projectPlayer } = await import('./projection.service.js');
      const projections = await Promise.all(found.map((r) => projectPlayer(r, gameweek)));
      heuristicProjectionLines = joinBlocks(...projections.map(formatPlayerProjection));
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
      case 'PLAYER_COMPARISON':
        return buildPlayerComparisonResult(userId, intent, message, gameweek, squadIds);

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

      // ── GENERAL HELP ───────────────────────────────────────────────────────
      case 'GENERAL_HELP': {
        // Keyword classification is intent-first, but a message that's just
        // player names ("Saka?", "Rogers or Havertz") matches no CAPTAINCY/
        // TRANSFER/etc keyword and lands here by default. Check for named
        // players before falling back to generic squad advice — the user
        // asked about specific players, so answer about those players.
        const mentionedForHelp = await findMentionedPlayers(message, 4);
        if (mentionedForHelp.length > 0) {
          return buildPlayerComparisonResult(userId, intent, message, gameweek, squadIds);
        }

        const intel = await buildSquadIntelligence(userId);
        if (!intel) return buildNoSquadFallback(intent, userId, message);

        const mlBlock = await buildMlRecommendationBlock({ userId, intent, squadPlayerIds: squadIds, gameweek });
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

      // ── INITIAL SQUAD ──────────────────────────────────────────────────────
      case 'INITIAL_SQUAD': {
        const intel = await buildSquadIntelligence(userId);
        if (!intel) return buildNoSquadFallback(intent, userId, message);

        const mlBlock = await buildMlRecommendationBlock({ userId, intent, squadPlayerIds: squadIds, gameweek });
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
