import type { PlayerPredictionDto } from './ml-prediction.types.js';
import {
  getRotationRisksByMlPrediction,
  getWeakestPlayersByMlPrediction,
  rankPlayersByMlPrediction,
  type RankedPlayer,
  type RankingContext,
} from './player-ranking.service.js';
import { defaultWeights } from './personalization.weights.js';

export interface MlSquadAdvice {
  optimalStarters: RankedPlayer[];
  benchOrder:      RankedPlayer[];
  weakLinks:       RankedPlayer[];
  rotationRisks:   RankedPlayer[];
  summary:         string;
}

function isGoalkeeper(p: PlayerPredictionDto): boolean { return p.position === 'GK'; }
function isOutfield(p: PlayerPredictionDto): boolean   { return p.position !== 'GK'; }

export function buildMlSquadAdvice(
  squadPredictions: PlayerPredictionDto[],
  ctx: RankingContext = { weights: defaultWeights() },
): MlSquadAdvice {
  const ranked = rankPlayersByMlPrediction(squadPredictions, ctx);

  // Filter the GK pool by playing probability so injured GKs don't start.
  const goalkeepers = ranked.filter(isGoalkeeper).filter((p) => p.probPlaying > 0.50);
  const outfield    = ranked.filter(isOutfield);

  const bestGoalkeeper = goalkeepers[0] ? [goalkeepers[0]] : [];
  const bestOutfield   = outfield.slice(0, 10);

  const optimalStarters = [...bestGoalkeeper, ...bestOutfield]
    .sort((a, b) => b.rankingScore - a.rankingScore);

  const starterIds = new Set(optimalStarters.map((p) => p.playerId));

  const benchOrder = ranked
    .filter((p) => !starterIds.has(p.playerId))
    .sort((a, b) => {
      const aIsGk = isGoalkeeper(a);
      const bIsGk = isGoalkeeper(b);
      if (aIsGk && !bIsGk) return 1;
      if (!aIsGk && bIsGk) return -1;
      return b.rankingScore - a.rankingScore;
    });

  const weakLinks     = getWeakestPlayersByMlPrediction(squadPredictions, 5, ctx);
  const rotationRisks = getRotationRisksByMlPrediction(squadPredictions, 5, ctx);

  const summary = optimalStarters.length
    ? `ML squad advice built from ${squadPredictions.length} squad predictions. ` +
      `Best projected starter: ${optimalStarters[0].webName} (${optimalStarters[0].predictedPtsGw1} xPts).`
    : 'No ML squad advice available because no squad predictions were found.';

  return { optimalStarters, benchOrder, weakLinks, rotationRisks, summary };
}