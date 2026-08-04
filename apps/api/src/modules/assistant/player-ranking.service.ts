import type { PlayerPredictionDto } from './ml-prediction.types.js';
import type { ScoringWeights } from './personalization.weights.js';
import {
  defaultWeights,
  differentialContribution,
  BIG_SIX_SHORT_NAMES,
} from './personalization.weights.js';
import type { TeamStrengthIndex, NextFixtureLookup } from './team-strength.service.js';
import { teamStrengthMultiplier } from './team-strength.service.js';

export interface RankedPlayer extends PlayerPredictionDto {
  rankingScore: number;
  riskLabel:    'LOW' | 'MEDIUM' | 'HIGH';
  reason:       string;

  // Diagnostic fields
  baseScore?:           number;
  ownTeamMultiplier?:   number;
  opponentMultiplier?:  number;
  combinedTeamMul?:     number;
  bigSixMultiplier?:    number;
  differentialAdd?:     number;
}

export interface RankingContext {
  weights:           ScoringWeights;
  teamIndex?:        TeamStrengthIndex;
  nextFixtures?:     NextFixtureLookup;    // NEW in V2
  teamShortById?:    Map<number, string>;
  ownershipById?:    Map<number, number>;
  teamIdByPlayerId?: Map<number, number>;
}

function riskLabel(p: PlayerPredictionDto): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (p.confidence === 'LOW' || p.probPlaying < 0.55 || p.predictedMinutes < 30) return 'HIGH';
  if (p.confidence === 'MEDIUM' || p.probPlaying < 0.75 || p.predictedMinutes < 60) return 'MEDIUM';
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

function computeRankingScore(p: PlayerPredictionDto, ctx: RankingContext) {
  const w = ctx.weights;

  // 1. Horizon-weighted xPts
  const horizon =
    p.predictedPtsGw1 * w.gw1Weight +
    p.predictedPtsGw3 * w.gw3Weight +
    p.predictedPtsGw5 * w.gw5Weight;

  // 2. Availability factor (profile-shaped)
  const availFloor = Math.max(0.15, p.probPlaying) * Math.max(0.20, p.prob60PlusMins);
  const availFactor = Math.pow(availFloor, w.availabilityPenalty);

  // 3. Confidence multiplier
  const confMul =
    p.confidence === 'HIGH'   ? 1.05 :
    p.confidence === 'MEDIUM' ? 1.00 : 0.82;

  const base = horizon * availFactor * confMul;

  // 4. Team-strength multiplier (V2: composite with opponent)
  let ownMul = 1.0, oppMul = 1.0, combined = 1.0;
  const teamId = ctx.teamIdByPlayerId?.get(p.playerId);
  if (teamId !== undefined && ctx.teamIndex) {
    const r = teamStrengthMultiplier(
      positionToInt(p.position), teamId, ctx.teamIndex,
      w.fixtureWeight, ctx.nextFixtures,
    );
    ownMul = r.ownTeamComponent;
    oppMul = r.opponentComponent;
    combined = r.multiplier;
  }

  // 5. Big-six multiplier
  let bigSixMul = 1.0;
  const teamShort = teamId !== undefined ? ctx.teamShortById?.get(teamId) : undefined;
  if (teamShort && BIG_SIX_SHORT_NAMES.has(teamShort)) {
    bigSixMul = w.bigSixMultiplier;
    if (p.position === 'DEF') bigSixMul *= w.topSixDefenderBoost;
  }

  const withTeam = base * combined * bigSixMul;

  // 6. Differential bonus
  let diffAdd = 0;
  if (ctx.ownershipById && w.differentialBonus > 0) {
    const ownership = ctx.ownershipById.get(p.playerId) ?? 50;
    diffAdd = differentialContribution(ownership, w.differentialBonus) * Math.max(2, withTeam);
  }

  return {
    total: Number((withTeam + diffAdd).toFixed(3)),
    breakdown: {
      baseScore:          Number(base.toFixed(3)),
      ownTeamMultiplier:  Number(ownMul.toFixed(3)),
      opponentMultiplier: Number(oppMul.toFixed(3)),
      combinedTeamMul:    Number(combined.toFixed(3)),
      bigSixMultiplier:   Number(bigSixMul.toFixed(3)),
      differentialAdd:    Number(diffAdd.toFixed(3)),
    },
  };
}

function buildReason(p: PlayerPredictionDto, risk: 'LOW' | 'MEDIUM' | 'HIGH'): string {
  return (
    `${p.webName} projects for ${p.predictedPtsGw1} xPts next GW, ` +
    `${p.predictedPtsGw3} xPts over 3 GWs, ` +
    `${Math.round(p.probPlaying * 100)}% playing probability, ` +
    `${p.predictedMinutes} predicted minutes, risk ${risk}.`
  );
}

export function rankPlayersByMlPrediction(
  players: PlayerPredictionDto[],
  ctx:     RankingContext = { weights: defaultWeights() },
): RankedPlayer[] {
  return players
    .map((p) => {
      const risk = riskLabel(p);
      const { total, breakdown } = computeRankingScore(p, ctx);
      return {
        ...p,
        rankingScore: total,
        riskLabel:    risk,
        reason:       buildReason(p, risk),
        ...breakdown,
      };
    })
    .sort((a, b) => b.rankingScore - a.rankingScore);
}

export function getWeakestPlayersByMlPrediction(
  players: PlayerPredictionDto[],
  limit = 5,
  ctx:     RankingContext = { weights: defaultWeights() },
): RankedPlayer[] {
  return rankPlayersByMlPrediction(players, ctx).slice(-limit).reverse();
}

export function getRotationRisksByMlPrediction(
  players: PlayerPredictionDto[],
  limit = 5,
  ctx:     RankingContext = { weights: defaultWeights() },
): RankedPlayer[] {
  return rankPlayersByMlPrediction(players, ctx)
    .filter((p) => p.riskLabel !== 'LOW' || p.predictedMinutes < 60 || p.probPlaying < 0.75)
    .sort((a, b) => {
      if (a.riskLabel !== b.riskLabel) {
        const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
        return order[a.riskLabel] - order[b.riskLabel];
      }
      return a.predictedMinutes - b.predictedMinutes;
    })
    .slice(0, limit);
}