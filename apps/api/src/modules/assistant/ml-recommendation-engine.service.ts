import type { AssistantIntent } from '@fpl/types';
import { prisma } from '../../db/prisma.js';

import {
  buildSquadPredictionSummary,
  getPredictionLookupForGameweek,
  getPredictionsForGameweek,
} from './ml-prediction.service.js';
import type { PlayerPredictionDto } from './ml-prediction.types.js';

import { recommendCaptaincyFromMl }  from './ml-captaincy.service.js';
import { recommendTransfersFromMl }  from './ml-transfer-recommendation.service.js';
import { buildMlSquadAdvice }        from './ml-squad-advisor.service.js';
import { rankPlayersByMlPrediction } from './player-ranking.service.js';

import { deriveScoringWeights }      from './personalization.weights.js';
import type { ScoringWeights }       from './personalization.weights.js';
import {
  buildTeamStrengthIndex,
  buildNextFixtureLookup,
} from './team-strength.service.js';
import type { TeamStrengthIndex, NextFixtureLookup } from './team-strength.service.js';
import {
  buildEligibilitySnapshots,
} from './player-eligibility.service.js';
import type { EligibilitySnapshot }  from './player-eligibility.service.js';

export interface MlRecommendationBlock {
  available:  boolean;
  intent:     AssistantIntent;
  summary:    string;
  structured: unknown;
  promptBlock: string;
}

function formatPlayer(p: PlayerPredictionDto): string {
  return (
    `${p.webName} (${p.club}, ${p.position}) — ` +
    `xPts next GW: ${p.predictedPtsGw1.toFixed(2)}, xPts total over 3 GWs: ${p.predictedPtsGw3.toFixed(2)}, ` +
    `${p.predictedMinutes} mins, ${Math.round(p.probPlaying * 100)}% playing, ` +
    `${p.confidence} confidence`
  );
}

function buildPromptBlock(title: string, lines: string[]): string {
  return [
    `ML recommendation block — ${title}`,
    ...lines,
    '',
    'Assistant rules:',
    '- Treat these values as model-based decision support, not certainty.',
    '- "xPts next GW" is a single-gameweek prediction (typical range 2-12).',
    '- "xPts total over 3 GWs" is a 3-GW CUMULATIVE total (typical range 8-25).',
    '- "xPts total over 5 GWs" is a 5-GW CUMULATIVE total (typical range 12-40).',
    '- NEVER state a per-GW projection above 15 — that range is for the multi-GW totals.',
    '- Do not invent projections not shown here.',
    '- When confidence is MEDIUM or LOW, explicitly mention uncertainty.',
    '- All candidates shown have passed eligibility checks (active in PL, recent minutes).',
    '- If a "team narrative" is shown for a candidate, you can repeat it in your reply.',
  ].join('\n');
}

async function getPerPositionCandidatePool(
  gameweek: number,
  perPosition: number = 25,
): Promise<PlayerPredictionDto[]> {
  const all = await getPredictionsForGameweek(gameweek);
  const byPos: Record<string, PlayerPredictionDto[]> = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const p of all) if (byPos[p.position]) byPos[p.position].push(p);
  const result: PlayerPredictionDto[] = [];
  for (const pos of ['GK', 'DEF', 'MID', 'FWD'] as const) {
    byPos[pos].sort((a, b) => b.predictedPtsGw3 - a.predictedPtsGw3);
    result.push(...byPos[pos].slice(0, perPosition));
  }
  return result;
}

async function buildTeamLookups(playerIds: number[]) {
  const players = await prisma.fplPlayer.findMany({
    where: { id: { in: playerIds } },
    select: { id: true, teamId: true, selectedByPercent: true },
  });
  const teamIds = [...new Set(players.map((p) => p.teamId))];
  const teams = await prisma.fplTeam.findMany({
    where: { id: { in: teamIds } },
    select: { id: true, shortName: true },
  });

  const teamIdByPlayerId = new Map<number, number>();
  const ownershipById = new Map<number, number>();
  for (const p of players) {
    teamIdByPlayerId.set(p.id, p.teamId);
    ownershipById.set(p.id, Number(p.selectedByPercent ?? 0));
  }
  const teamShortById = new Map<number, string>();
  for (const t of teams) teamShortById.set(t.id, t.shortName);
  return { teamIdByPlayerId, teamShortById, ownershipById };
}

async function loadUserProfile(userId: string) {
  const raw = await prisma.userAssistantProfile.findUnique({ where: { userId } });
  if (!raw) return null;
  let extras: Record<string, unknown> = {};
  if (raw.notes && typeof raw.notes === 'string') {
    try { extras = JSON.parse(raw.notes); } catch { extras = {}; }
  } else if (raw.notes && typeof raw.notes === 'object') {
    extras = raw.notes as Record<string, unknown>;
  }
  return {
    riskTolerance:          raw.riskTolerance,
    budgetStyle:            raw.budgetStyle,
    preferredFocus:         raw.preferredFocus,
    differentialPreference: raw.differentialPreference,
    planningHorizon:        raw.planningHorizon,
    explanationDepth:       raw.explanationDepth,
    topSixAffinity:         typeof extras.topSixAffinity     === 'number' ? extras.topSixAffinity     : undefined,
    captaincyStyle:         typeof extras.captaincyStyle     === 'number' ? extras.captaincyStyle     : undefined,
    transferFrequency:      typeof extras.transferFrequency  === 'number' ? extras.transferFrequency  : undefined,
    fixtureAwareness:       typeof extras.fixtureAwareness   === 'number' ? extras.fixtureAwareness   : undefined,
  };
}

export async function buildMlRecommendationBlock(params: {
  userId:              string;
  intent:              AssistantIntent;
  squadPlayerIds:      number[];
  gameweek?:           number | null;
  mentionedPlayerIds?: number[];
}): Promise<MlRecommendationBlock> {
  const { userId, intent, squadPlayerIds, gameweek, mentionedPlayerIds } = params;

  const summary = await buildSquadPredictionSummary(squadPlayerIds, gameweek);
  if (!summary || !summary.players.length) {
    return {
      available:   false,
      intent,
      summary:     'No ML predictions matched the current squad.',
      structured:  null,
      promptBlock: buildPromptBlock('Unavailable', [
        'No ML predictions matched the current squad.',
        'Use rule-based recommendation context only.',
      ]),
    };
  }

  const profile = await loadUserProfile(userId);
  const weights: ScoringWeights = deriveScoringWeights(profile);

  const teamIndex: TeamStrengthIndex = await buildTeamStrengthIndex();
  const nextFixtures: NextFixtureLookup = await buildNextFixtureLookup(summary.gameweek);

  const candidatePool =
    (intent === 'TRANSFER_ADVICE' || intent === 'TRANSFER_EVALUATION') && summary.gameweek
      ? await getPerPositionCandidatePool(summary.gameweek, 25)
      : [];

  const allPlayerIds = new Set<number>([
    ...squadPlayerIds,
    ...candidatePool.map((p) => p.playerId),
    ...(mentionedPlayerIds ?? []),
  ]);
  const idArray = [...allPlayerIds];

  const eligibility = await buildEligibilitySnapshots(idArray);
  const { teamIdByPlayerId, teamShortById, ownershipById } = await buildTeamLookups(idArray);

  const sharedCtx = {
    weights, teamIndex, nextFixtures,
    teamIdByPlayerId, teamShortById, ownershipById, eligibility,
  };

  // CAPTAINCY
  if (intent === 'CAPTAINCY') {
    const result = recommendCaptaincyFromMl(summary.players, {
      weights, teamIndex, nextFixtures, teamIdByPlayerId,
    });

    return {
      available:  true,
      intent,
      summary:    result.summary,
      structured: result,
      promptBlock: buildPromptBlock('Captaincy', [
        result.captain
          ? `Recommended captain:      ${formatPlayer(result.captain)}` +
            (result.captain.teamNarrative ? ` — ${result.captain.teamNarrative}` : '')
          : 'Recommended captain: none',
        result.viceCaptain
          ? `Recommended vice-captain: ${formatPlayer(result.viceCaptain)}` +
            (result.viceCaptain.teamNarrative ? ` — ${result.viceCaptain.teamNarrative}` : '')
          : 'Recommended vice-captain: none',
        '',
        'Alternatives:',
        ...result.alternatives.map((p, i) =>
          `${i + 1}. ${formatPlayer(p)}${p.teamNarrative ? ` — ${p.teamNarrative}` : ''}`),
        '',
        `Profile note: captaincy conservatism = ${weights.captaincyConservatism.toFixed(2)} ` +
        `(higher = safer captain preferred).`,
      ]),
    };
  }

  // TRANSFER
  if (intent === 'TRANSFER_ADVICE' || intent === 'TRANSFER_EVALUATION') {
    const result = recommendTransfersFromMl({
      squadPredictions: summary.players,
      candidatePool,
      maxResults: 8,
      ctx: sharedCtx,
    });

    const filterNote = result.filteredOutCount > 0
      ? `${result.filteredOutCount} candidate(s) excluded as ineligible (not in PL or no recent minutes).`
      : 'All candidates passed eligibility checks.';

    return {
      available:  true,
      intent,
      summary:    result.summary,
      structured: result,
      promptBlock: buildPromptBlock('Transfers', [
        result.summary,
        '',
        'Top ML transfer candidates:',
        ...result.candidates.map((c, i) =>
          `${i + 1}. ${c.outgoing.webName} → ${c.incoming.webName}: ` +
          `${c.deltaGw3 >= 0 ? '+' : ''}${c.deltaGw3} xPts over 3 GWs, risk ${c.risk}` +
          (c.incomingNarrative ? `. Context: ${c.incomingNarrative}` : '.'),
        ),
        '',
        filterNote,
        `Profile note: horizon weights = ` +
          `GW1 ${(weights.gw1Weight * 100).toFixed(0)}% / GW3 ${(weights.gw3Weight * 100).toFixed(0)}% / GW5 ${(weights.gw5Weight * 100).toFixed(0)}%.`,
      ]),
    };
  }

  // BENCH / FORMATION
  if (intent === 'BENCH_ORDER' || intent === 'FORMATION_ADVICE') {
    const advice = buildMlSquadAdvice(summary.players, sharedCtx);
    return {
      available:  true,
      intent,
      summary:    advice.summary,
      structured: advice,
      promptBlock: buildPromptBlock('Squad / Bench / Formation', [
        advice.summary,
        '',
        'Suggested starters (ML-ranked):',
        ...advice.optimalStarters.map((p, i) => `${i + 1}. ${formatPlayer(p)}`),
        '',
        'Suggested bench order:',
        ...advice.benchOrder.map((p, i) => `${i + 1}. ${formatPlayer(p)}`),
        '',
        'Rotation risks:',
        ...advice.rotationRisks.map((p, i) => `${i + 1}. ${formatPlayer(p)}`),
      ]),
    };
  }

  // PLAYER COMPARISON
  if (intent === 'PLAYER_COMPARISON') {
    if (mentionedPlayerIds && mentionedPlayerIds.length >= 2) {
      const lookup = await getPredictionLookupForGameweek(gameweek);
      const predA = lookup.byPlayerId.get(mentionedPlayerIds[0]);
      const predB = lookup.byPlayerId.get(mentionedPlayerIds[1]);
      if (predA && predB) {
        const deltaGw1 = Number((predA.predictedPtsGw1 - predB.predictedPtsGw1).toFixed(2));
        const deltaGw3 = Number((predA.predictedPtsGw3 - predB.predictedPtsGw3).toFixed(2));
        const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
        const compSummary =
          `ML comparison: ${predA.webName} vs ${predB.webName}. ` +
          `GW1 delta: ${sign(deltaGw1)} pts. 3-GW total delta: ${sign(deltaGw3)} pts.`;
        return {
          available:  true,
          intent,
          summary:    compSummary,
          structured: { playerA: predA, playerB: predB },
          promptBlock: buildPromptBlock('Player Comparison (ML)', [
            `Player A: ${formatPlayer(predA)}`,
            `Player B: ${formatPlayer(predB)}`,
            '',
            `GW1 delta (per-GW): ${sign(deltaGw1)} pts in favour of ${deltaGw1 >= 0 ? predA.webName : predB.webName}`,
            `3-GW total delta: ${sign(deltaGw3)} pts in favour of ${deltaGw3 >= 0 ? predA.webName : predB.webName}`,
          ]),
        };
      }
    }
    const ranked = rankPlayersByMlPrediction(summary.players, sharedCtx).slice(0, 8);
    return {
      available:  true,
      intent,
      summary:    `Top ML-ranked squad player: ${ranked[0]?.webName ?? 'none'}.`,
      structured: { ranked },
      promptBlock: buildPromptBlock('General ML squad context (comparison fallback)', [
        'Note: ML predictions were not found for the mentioned players.',
        'Showing general squad ML context instead.',
        '',
        `Prediction GW: ${summary.gameweek}`,
        `Model: ${summary.modelVersion ?? 'unknown'}`,
        '',
        'Top ML-ranked squad players:',
        ...ranked.map((p, i) => `${i + 1}. ${formatPlayer(p)}`),
      ]),
    };
  }

  // GENERAL HELP / DEFAULT
  const ranked = rankPlayersByMlPrediction(summary.players, sharedCtx).slice(0, 8);
  return {
    available:  true,
    intent,
    summary:    `Top ML-ranked squad player: ${ranked[0]?.webName ?? 'none'}.`,
    structured: { ranked },
    promptBlock: buildPromptBlock('General ML squad context', [
      `Prediction GW: ${summary.gameweek}`,
      `Model: ${summary.modelVersion ?? 'unknown'}`,
      '',
      'Top ML-ranked squad players:',
      ...ranked.map((p, i) => `${i + 1}. ${formatPlayer(p)}`),
    ]),
  };
}