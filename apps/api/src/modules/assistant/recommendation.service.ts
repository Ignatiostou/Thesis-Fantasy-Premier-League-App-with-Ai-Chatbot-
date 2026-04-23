// apps/api/src/modules/ai/recommendation.service.ts
// Phase 5 update: squad-intelligence engine integrated for formation,
// bench order, lineup, and weak link intents.
// Phase 4 projection engine still runs for captaincy, comparison, transfer.

import type { AssistantIntent } from '@fpl/types';
import type {
  RecommendationContextBlock,
  CaptainCandidateSummary,
  PlayerComparisonSimpleResult,
  TransferEvaluationResult,
} from './recommendation.types.js';
import { getCaptainRecommendations } from './captaincy.service.js';
import { compareMentionedPlayers }   from './player-comparison.service.js';
import { evaluateMentionedTransfer } from './transfer-evaluator.service.js';
import {
  projectCaptainOptions,
  projectTransferDelta,
}                                    from './projection.service.js';
import {
  formatCaptainProjection,
  formatTransferDelta,
  formatPlayerProjection,
}                                    from './projection.formatter.js';
import {
  buildSquadIntelligence,
  analyseWeakLinks,
  optimiseLineup,
  optimiseBenchOrder,
  recommendFormation,
}                                    from './squad-intelligence.engine.js';
import {
  formatForIntent,
  formatLineupOptimization,
  formatFormationRecommendation,
  formatBenchOrder,
  formatWeakLinks,
}                                    from './squad-intelligence.formatter.js';
import { findMentionedPlayers }      from './player-search.service.js';
import { getEditableGameweekId }     from '../../utils/gameweek.js';
import { prisma }                    from '../../db/prisma.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCost(tenths: number): string {
  return `£${(tenths / 10).toFixed(1)}m`;
}

// ── Captain formatter (Phase 3 + Phase 4) ────────────────────────────────────

function formatCaptainSummary(
  candidates:      CaptainCandidateSummary[],
  projectionBlock: string,
): string {
  const lines: string[] = ['=== CAPTAINCY ANALYSIS ===', ''];

  if (projectionBlock) {
    lines.push(projectionBlock);
    lines.push('');
  }

  if (candidates.length > 0) {
    lines.push(`Rule-based scoring (form + fixture + availability):`, '');
    candidates.forEach((c, i) => {
      const riskText = c.risk.length ? c.risk.join('; ') : 'none identified';
      lines.push(`${i + 1}. ${c.webName} (${c.club}, ${c.position})`);
      lines.push(`   Composite score: ${c.score}`);
      lines.push(`   Reasons: ${c.reasons.join('; ') || 'general consistency'}`);
      lines.push(`   Risks: ${riskText}`);
      lines.push('');
    });
  }

  lines.push('INSTRUCTION: Use projected captain xPts as the primary ranking.');
  lines.push('Distinguish between the safe pick and the upside pick.');
  lines.push('Do NOT mention captain options not listed above.');
  return lines.join('\n');
}

// ── Comparison formatter (Phase 3 + Phase 4 xPts) ────────────────────────────

function formatComparisonSummary(result: PlayerComparisonSimpleResult): string {
  if (!result.found || result.players.length < 2) {
    return [
      '=== PLAYER COMPARISON ===',
      result.recommendation ?? 'Could not identify two players to compare.',
      'Ask the manager to clarify which players they want to compare.',
    ].join('\n');
  }

  const [a, b] = result.players;
  const lines: string[] = ['=== PLAYER COMPARISON ===', ''];

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
  lines.push('');
  lines.push('INSTRUCTION: Use the data above. Present a clear final recommendation. Do NOT invent stats.');
  return lines.join('\n');
}

// ── Transfer formatter (Phase 3 + Phase 4 delta + Phase 5 weak links) ─────────

function formatTransferSummary(
  result:          TransferEvaluationResult,
  projectionBlock: string,
  weakLinksBlock:  string,
): string {
  if (!result.detected) {
    return [
      '=== TRANSFER EVALUATION ===',
      result.recommendation ?? 'Could not identify a specific transfer from the message.',
      weakLinksBlock ? `\n${weakLinksBlock}` : '',
      "Provide general transfer advice based on the manager's squad, bank, and free transfers.",
    ].filter(Boolean).join('\n');
  }

  const lines: string[] = ['=== TRANSFER EVALUATION ===', ''];

  if (projectionBlock) { lines.push(projectionBlock); lines.push(''); }

  lines.push('RULE & BUDGET CHECKS:');
  if (result.outgoingPlayer) {
    const out = result.outgoingPlayer;
    lines.push(`  OUT: ${out.webName} (${out.club}, ${out.position})${out.sellPrice !== undefined ? ` — sell: ${fmtCost(out.sellPrice)}` : ''}`);
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
    lines.push(`  Club limit: ${rc.maxPerClubLikelyOk ? 'OK ✓' : 'MAY BREAK 3-per-club ✗'}`);
  }
  if (result.risks?.length) {
    lines.push('  Risks: ' + result.risks.join('; '));
  }

  lines.push('');
  lines.push(`VERDICT: ${result.recommendation}`);

  if (weakLinksBlock) { lines.push(''); lines.push(weakLinksBlock); }

  lines.push('');
  lines.push('INSTRUCTION: Lead with the xPts delta. Confirm budget/rule validity.');
  lines.push('If the transfer targets a weak link identified above, mention that context.');
  return lines.join('\n');
}

// ── Main orchestrator ─────────────────────────────────────────────────────────

export async function buildRecommendationContext(params: {
  userId:  string;
  intent:  AssistantIntent;
  message: string;
}): Promise<RecommendationContextBlock | null> {
  const { userId, intent, message } = params;

  try {
    switch (intent) {

      // ── CAPTAINCY — Phase 4 projections + Phase 3 rule scoring ─────────────
      case 'CAPTAINCY': {
        const [candidates, captainProj] = await Promise.all([
          getCaptainRecommendations(userId),
          projectCaptainOptions(userId),
        ]);
        const projBlock = captainProj ? formatCaptainProjection(captainProj) : '';
        return {
          intent,
          summary:    formatCaptainSummary(candidates, projBlock),
          structured: { candidates, projection: captainProj } as Record<string, unknown>,
        };
      }

      // ── PLAYER COMPARISON — Phase 4 individual projections ─────────────────
      case 'PLAYER_COMPARISON': {
        const gameweek  = await getEditableGameweekId();
        const mentioned = await findMentionedPlayers(message, 4);
        const compResult = await compareMentionedPlayers(message);

        let projectionLines = '';
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
            projectionLines = [
              '=== xPTS PROJECTION COMPARISON ===',
              '',
              formatPlayerProjection(projA),
              '',
              formatPlayerProjection(projB),
            ].join('\n');
          }
        }

        return {
          intent,
          summary:    [projectionLines, formatComparisonSummary(compResult)].filter(Boolean).join('\n\n'),
          structured: { comparison: compResult } as Record<string, unknown>,
        };
      }

      // ── TRANSFER — Phase 4 delta + Phase 5 weak links ──────────────────────
      case 'TRANSFER_EVALUATION':
      case 'TRANSFER_ADVICE': {
        const gameweek = await getEditableGameweekId();
        const team     = await prisma.userTeam.findUnique({ where: { userId }, select: { id: true } });
        const gwState  = team ? await prisma.userGameweekState.findUnique({
          where: { userTeamId_gameweek: { userTeamId: team.id, gameweek } },
        }) : null;
        const freeTransfers = gwState?.freeTransfers ?? 1;

        const [transferResult, weakLinksData] = await Promise.all([
          evaluateMentionedTransfer(userId, message),
          analyseWeakLinks(userId, freeTransfers),
        ]);

        let projBlock    = '';
        let weakLinksBlock = weakLinksData ? formatWeakLinks(weakLinksData) : '';

        if (transferResult.detected && transferResult.outgoingPlayer && transferResult.incomingPlayer) {
          const delta = await projectTransferDelta(
            transferResult.outgoingPlayer.playerId,
            transferResult.incomingPlayer.playerId,
            freeTransfers,
            0,
          );
          if (delta) projBlock = formatTransferDelta(delta);
        }

        return {
          intent,
          summary:    formatTransferSummary(transferResult, projBlock, weakLinksBlock),
          structured: { transfer: transferResult } as Record<string, unknown>,
        };
      }

      // ── FORMATION ADVICE — Phase 5 formation recommender ───────────────────
      case 'FORMATION_ADVICE': {
        const [formationRec, lineupOpt] = await Promise.all([
          recommendFormation(userId),
          optimiseLineup(userId),
        ]);
        if (!formationRec) return null;

        const parts: string[] = [formatFormationRecommendation(formationRec)];
        if (lineupOpt) { parts.push(''); parts.push(formatLineupOptimization(lineupOpt)); }

        return {
          intent,
          summary:    parts.join('\n'),
          structured: { formation: formationRec } as Record<string, unknown>,
        };
      }

      // ── BENCH ORDER — Phase 5 bench order engine ────────────────────────────
      case 'BENCH_ORDER': {
        const benchRec = await optimiseBenchOrder(userId);
        if (!benchRec) return null;
        return {
          intent,
          summary:    formatBenchOrder(benchRec),
          structured: { benchOrder: benchRec } as Record<string, unknown>,
        };
      }

      // ── GENERAL HELP / INITIAL SQUAD — full squad intelligence ─────────────
      case 'GENERAL_HELP':
      case 'INITIAL_SQUAD': {
        const intel = await buildSquadIntelligence(userId);
        if (!intel) return null;
        return {
          intent,
          summary:    formatForIntent(intel, intent),
          structured: null,
        };
      }

      // ── CHIP ADVICE — lineup + weak links context ───────────────────────────
      case 'CHIP_ADVICE': {
        const [lineupOpt, weakLinksData] = await Promise.all([
          optimiseLineup(userId),
          analyseWeakLinks(userId),
        ]);
        const parts: string[] = [];
        if (lineupOpt)     parts.push(formatLineupOptimization(lineupOpt));
        if (weakLinksData) parts.push(formatWeakLinks(weakLinksData));

        if (parts.length === 0) return null;

        return {
          intent,
          summary: [
            parts.join('\n\n'),
            '',
            'Use the lineup and weak links above to assess chip timing.',
            'High projectedGwScore with strong players → consider Bench Boost / Triple Captain.',
            'Multiple risk players or weak links → consider Free Hit.',
          ].join('\n'),
          structured: null,
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