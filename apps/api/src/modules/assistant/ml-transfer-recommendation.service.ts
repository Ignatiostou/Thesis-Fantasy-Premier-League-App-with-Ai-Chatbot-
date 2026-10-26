import type { PlayerPredictionDto } from './ml-prediction.types.js';
import type { ScoringWeights } from './personalization.weights.js';
import {
  defaultWeights,
  differentialContribution,
  BIG_SIX_SHORT_NAMES,
} from './personalization.weights.js';
import type { TeamStrengthIndex, NextFixtureLookup } from './team-strength.service.js';
import { teamStrengthMultiplier, explainTeamStrength } from './team-strength.service.js';
import type { EligibilitySnapshot } from './player-eligibility.service.js';
import { filterEligible } from './player-eligibility.service.js';

export interface TransferCandidate {
  outgoing:      PlayerPredictionDto;
  incoming:      PlayerPredictionDto;
  deltaGw1:      number;
  deltaGw3:      number;
  deltaGw5:      number;
  transferScore: number;
  risk:          'LOW' | 'MEDIUM' | 'HIGH';
  explanation:   string;

  // Diagnostic
  baseScore?:          number;
  incomingOwnMul?:     number;
  incomingOppMul?:     number;
  incomingCombinedMul?:number;
  outgoingCombinedMul?:number;
  matchupSwing?:       number;
  differentialAdd?:    number;
  incomingNarrative?:  string;
}

export interface TransferRecommendationResult {
  candidates:       TransferCandidate[];
  summary:          string;
  filteredOutCount: number;
}

export interface TransferContext {
  weights:           ScoringWeights;
  teamIndex?:        TeamStrengthIndex;
  nextFixtures?:     NextFixtureLookup;
  teamShortById?:    Map<number, string>;
  teamIdByPlayerId?: Map<number, number>;
  ownershipById?:    Map<number, number>;
  eligibility?:      Map<number, EligibilitySnapshot>;
}

function transferRisk(p: PlayerPredictionDto): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (p.confidence === 'LOW' || p.probPlaying < 0.60 || p.predictedMinutes < 35) return 'HIGH';
  if (p.confidence === 'MEDIUM' || p.probPlaying < 0.80 || p.predictedMinutes < 60) return 'MEDIUM';
  return 'LOW';
}

function positionToInt(pos: PlayerPredictionDto['position']): number {
  switch (pos) {
    case 'GK':  return 1;
    case 'DEF': return 2;
    case 'MID': return 3;
    case 'FWD': return 4;
    default:    return 0;
  }
}

function computeTransferScore(
  outgoing: PlayerPredictionDto,
  incoming: PlayerPredictionDto,
  ctx:      TransferContext,
) {
  const w = ctx.weights;

  const deltaGw1 = incoming.predictedPtsGw1 - outgoing.predictedPtsGw1;
  const deltaGw3 = incoming.predictedPtsGw3 - outgoing.predictedPtsGw3;
  const deltaGw5 = incoming.predictedPtsGw5 - outgoing.predictedPtsGw5;

  const horizonDelta =
    deltaGw1 * w.gw1Weight +
    deltaGw3 * w.gw3Weight +
    deltaGw5 * w.gw5Weight;

  const riskMul =
    incoming.confidence === 'HIGH'   ? 1.05 :
    incoming.confidence === 'MEDIUM' ? 1.00 : 0.75;

  const availMul = Math.pow(Math.max(0.20, incoming.probPlaying), w.availabilityPenalty);

  const base = horizonDelta * riskMul * availMul;

  // Compute multipliers for BOTH players — the swing matters.
  const inTeamId  = ctx.teamIdByPlayerId?.get(incoming.playerId);
  const outTeamId = ctx.teamIdByPlayerId?.get(outgoing.playerId);

  let inOwn = 1.0, inOpp = 1.0, inCombined = 1.0;
  let outCombined = 1.0;
  let narrative = '';

  if (inTeamId !== undefined && ctx.teamIndex) {
    const r = teamStrengthMultiplier(
      positionToInt(incoming.position), inTeamId, ctx.teamIndex,
      w.fixtureWeight, ctx.nextFixtures,
    );
    inOwn = r.ownTeamComponent;
    inOpp = r.opponentComponent;
    inCombined = r.multiplier;
    narrative = explainTeamStrength(positionToInt(incoming.position), inTeamId, ctx.teamIndex, ctx.nextFixtures);
  }
  if (outTeamId !== undefined && ctx.teamIndex) {
    const r = teamStrengthMultiplier(
      positionToInt(outgoing.position), outTeamId, ctx.teamIndex,
      w.fixtureWeight, ctx.nextFixtures,
    );
    outCombined = r.multiplier;
  }

  // The matchup swing: ratio of multipliers reflects "how much better is the
  // incoming player's situation". Positive (>1) means the swap improves the
  // overall matchup quality, negative dampens.
  const matchupSwing = inCombined / Math.max(0.7, outCombined);

  // Big-six on incoming only
  let bigSixMul = 1.0;
  const inShort = inTeamId !== undefined ? ctx.teamShortById?.get(inTeamId) : undefined;
  if (inShort && BIG_SIX_SHORT_NAMES.has(inShort)) {
    bigSixMul = w.bigSixMultiplier;
    if (incoming.position === 'DEF') bigSixMul *= w.topSixDefenderBoost;
  }

  let diffAdd = 0;
  if (ctx.ownershipById && w.differentialBonus > 0) {
    const ownership = ctx.ownershipById.get(incoming.playerId) ?? 50;
    diffAdd = differentialContribution(ownership, w.differentialBonus) * Math.max(2, Math.abs(base));
  }

  const total = base * matchupSwing * bigSixMul + diffAdd;

  return {
    total: Number(total.toFixed(3)),
    base, inOwn, inOpp, inCombined, outCombined, matchupSwing, diffAdd, narrative,
  };
}

export function recommendTransfersFromMl(params: {
  squadPredictions: PlayerPredictionDto[];
  candidatePool:    PlayerPredictionDto[];
  maxResults?:      number;
  ctx?:             TransferContext;
}): TransferRecommendationResult {
  const ctx = params.ctx ?? { weights: defaultWeights() };
  const { squadPredictions, candidatePool } = params;
  const maxResults = params.maxResults ?? 8;

  const squadIds = new Set(squadPredictions.map((p) => p.playerId));

  // Outgoing: bottom-6 by GW3
  const outgoingOptions = [...squadPredictions]
    .sort((a, b) => a.predictedPtsGw3 - b.predictedPtsGw3)
    .slice(0, 6);

  let rawIncoming = candidatePool
    .filter((p) => !squadIds.has(p.playerId))
    .filter((p) => p.confidence !== 'LOW')
    .filter((p) => p.probPlaying >= 0.65);

  let filteredOutCount = 0;
  if (ctx.eligibility) {
    const before = rawIncoming.length;
    rawIncoming = filterEligible(rawIncoming, ctx.eligibility, 'STRICT');
    filteredOutCount = before - rawIncoming.length;
  }

  const incomingOptions = rawIncoming
    .sort((a, b) => b.predictedPtsGw3 - a.predictedPtsGw3)
    .slice(0, 40);

  const candidates: TransferCandidate[] = [];
  for (const outgoing of outgoingOptions) {
    for (const incoming of incomingOptions) {
      if (incoming.position !== outgoing.position) continue;

      const deltaGw1 = Number((incoming.predictedPtsGw1 - outgoing.predictedPtsGw1).toFixed(2));
      const deltaGw3 = Number((incoming.predictedPtsGw3 - outgoing.predictedPtsGw3).toFixed(2));
      const deltaGw5 = Number((incoming.predictedPtsGw5 - outgoing.predictedPtsGw5).toFixed(2));

      if (deltaGw3 <= 0) continue;

      const risk = transferRisk(incoming);
      const r = computeTransferScore(outgoing, incoming, ctx);

      // A positive GW3 delta alone can hide a loss over the preferred horizon.
      // Only present moves with a positive, finite personalised score.
      if (!Number.isFinite(r.total) || r.total <= 0) continue;

      candidates.push({
        outgoing, incoming,
        deltaGw1, deltaGw3, deltaGw5,
        transferScore: r.total,
        risk,
        baseScore:           Number(r.base.toFixed(3)),
        incomingOwnMul:      Number(r.inOwn.toFixed(3)),
        incomingOppMul:      Number(r.inOpp.toFixed(3)),
        incomingCombinedMul: Number(r.inCombined.toFixed(3)),
        outgoingCombinedMul: Number(r.outCombined.toFixed(3)),
        matchupSwing:        Number(r.matchupSwing.toFixed(3)),
        differentialAdd:     Number(r.diffAdd.toFixed(3)),
        incomingNarrative:   r.narrative,
        explanation:
          `${incoming.webName} improves on ${outgoing.webName} by ` +
          `${deltaGw3 >= 0 ? '+' : ''}${deltaGw3} projected points over 3 GWs. ` +
          `Incoming risk: ${risk}.` +
          (r.narrative ? ` Context: ${r.narrative}.` : ''),
      });
    }
  }

  const ranked = candidates
    .sort((a, b) => b.transferScore - a.transferScore)
    .slice(0, maxResults);

  const summary = ranked.length
    ? `Found ${ranked.length} ML-supported transfer candidates. ` +
      `Best move: ${ranked[0].outgoing.webName} → ${ranked[0].incoming.webName}, ` +
      `${ranked[0].deltaGw3 >= 0 ? '+' : ''}${ranked[0].deltaGw3} xPts over 3 GWs.` +
      (filteredOutCount > 0
        ? ` (${filteredOutCount} candidate(s) excluded as ineligible — not currently in PL or no recent minutes.)`
        : '')
    : 'No clearly positive ML transfer candidates were found that passed eligibility filters.';

  return { candidates: ranked, summary, filteredOutCount };
}
