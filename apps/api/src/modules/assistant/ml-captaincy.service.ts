import type { PlayerPredictionDto } from './ml-prediction.types.js';
import type { ScoringWeights } from './personalization.weights.js';
import { defaultWeights } from './personalization.weights.js';
import type { TeamStrengthIndex, NextFixtureLookup } from './team-strength.service.js';
import { teamStrengthMultiplier, explainTeamStrength } from './team-strength.service.js';

export interface CaptaincyCandidate extends PlayerPredictionDto {
  captaincyScore: number;
  captaincyRisk:  'LOW' | 'MEDIUM' | 'HIGH';
  explanation:    string;

  // Diagnostic
  baseScore?:          number;
  ownTeamMultiplier?:  number;
  opponentMultiplier?: number;
  combinedTeamMul?:    number;
  riskAdjustment?:     number;
  teamNarrative?:      string;
}

export interface CaptaincyRecommendation {
  captain:      CaptaincyCandidate | null;
  viceCaptain:  CaptaincyCandidate | null;
  alternatives: CaptaincyCandidate[];
  summary:      string;
}

export interface CaptaincyContext {
  weights:           ScoringWeights;
  teamIndex?:        TeamStrengthIndex;
  nextFixtures?:     NextFixtureLookup;
  teamIdByPlayerId?: Map<number, number>;
}

function captaincyRisk(p: PlayerPredictionDto): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (p.confidence === 'LOW' || p.probPlaying < 0.60 || p.predictedMinutes < 45) return 'HIGH';
  if (p.confidence === 'MEDIUM' || p.probPlaying < 0.80 || p.predictedMinutes < 65) return 'MEDIUM';
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

function computeCaptaincyScore(
  p:    PlayerPredictionDto,
  risk: 'LOW' | 'MEDIUM' | 'HIGH',
  ctx:  CaptaincyContext,
) {
  const w = ctx.weights;
  const minutesMul = Math.max(0.15, p.prob60PlusMins);
  const confMul    =
    p.confidence === 'HIGH'   ? 1.08 :
    p.confidence === 'MEDIUM' ? 1.00 : 0.75;

  // predictedPtsGw1 already carries the appearance probability, so the old
  // extra playMul term applied it twice and buried nailed-on premiums beneath
  // safer but lower-ceiling picks. The 60-minute term stays: an early
  // substitution wastes the armband over and above the points lost.
  const base = p.predictedPtsGw1 * minutesMul * confMul;

  let ownMul = 1.0, oppMul = 1.0, combined = 1.0, narrative = '';
  const teamId = ctx.teamIdByPlayerId?.get(p.playerId);
  if (teamId !== undefined && ctx.teamIndex) {
    const r = teamStrengthMultiplier(
      positionToInt(p.position), teamId, ctx.teamIndex,
      w.fixtureWeight, ctx.nextFixtures,
    );
    ownMul = r.ownTeamComponent;
    oppMul = r.opponentComponent;
    combined = r.multiplier;
    narrative = explainTeamStrength(positionToInt(p.position), teamId, ctx.teamIndex, ctx.nextFixtures);
  }

  // Risk adjustment scaled by captaincyConservatism
  const baseHigh   = 0.75;
  const baseMedium = 0.95;
  let riskAdj = 1.0;
  if (risk === 'HIGH') {
    riskAdj = Math.max(0.40, baseHigh / w.captaincyConservatism);
  } else if (risk === 'MEDIUM') {
    riskAdj = Math.max(0.70, baseMedium / Math.max(1.0, w.captaincyConservatism));
  }

  return {
    score: Number((base * combined * riskAdj).toFixed(3)),
    ownMul, oppMul, combined, riskAdj, base, narrative,
  };
}

function explain(p: PlayerPredictionDto, risk: 'LOW' | 'MEDIUM' | 'HIGH'): string {
  return (
    `${p.webName} has ${p.predictedPtsGw1} projected GW points, ` +
    `${Math.round(p.probPlaying * 100)}% chance of playing, ` +
    `${p.predictedMinutes} predicted minutes and ${p.confidence} model confidence. ` +
    `Captaincy risk: ${risk}.`
  );
}

export function recommendCaptaincyFromMl(
  squadPredictions: PlayerPredictionDto[],
  ctx: CaptaincyContext = { weights: defaultWeights() },
): CaptaincyRecommendation {
  const candidates: CaptaincyCandidate[] = squadPredictions
    .map((p) => {
      const risk = captaincyRisk(p);
      const r = computeCaptaincyScore(p, risk, ctx);
      return {
        ...p,
        captaincyScore:     r.score,
        captaincyRisk:      risk,
        explanation:        explain(p, risk),
        baseScore:          Number(r.base.toFixed(3)),
        ownTeamMultiplier:  Number(r.ownMul.toFixed(3)),
        opponentMultiplier: Number(r.oppMul.toFixed(3)),
        combinedTeamMul:    Number(r.combined.toFixed(3)),
        riskAdjustment:     Number(r.riskAdj.toFixed(3)),
        teamNarrative:      r.narrative,
      };
    })
    .sort((a, b) => b.captaincyScore - a.captaincyScore);

  const safe = candidates.filter((p) => p.captaincyRisk !== 'HIGH');
  const captain = safe[0] ?? candidates[0] ?? null;
  const viceCaptain =
    safe.find((p) => p.playerId !== captain?.playerId) ??
    candidates.find((p) => p.playerId !== captain?.playerId) ??
    null;
  const alternatives = candidates
    .filter((p) => p.playerId !== captain?.playerId && p.playerId !== viceCaptain?.playerId)
    .slice(0, 4);

  const summary = captain
    ? `Best ML captain candidate is ${captain.webName} with ${captain.predictedPtsGw1} xPts and ${captain.captaincyRisk} captaincy risk.`
    : 'No captaincy recommendation available because no squad predictions were found.';

  return { captain, viceCaptain, alternatives, summary };
}