export type PredictionConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface PlayerPredictionDto {
  playerId:         number;
  webName:          string;
  club:             string;
  position:         'GK' | 'DEF' | 'MID' | 'FWD' | 'UNK';
  gameweek:         number;
  predictedPtsGw1:  number;
  predictedPtsGw3:  number;
  predictedPtsGw5:  number;
  predictedMinutes: number;
  probPlaying:      number;      // 0.0–1.0
  prob60PlusMins:   number;      // 0.0–1.0
  confidence:       PredictionConfidence;
  modelVersion:     string;
  generatedAt:      string;
}

export interface SquadPredictionSummary {
  gameweek:             number;
  modelVersion:         string | null;
  mlCoverage:           number;          // % of requested playerIds that have ML predictions (0–100)
  players:              PlayerPredictionDto[];
  topCaptainCandidates: PlayerPredictionDto[];
  strongestPlayers:     PlayerPredictionDto[];
  rotationRisks:        PlayerPredictionDto[];
  weakLinks:            PlayerPredictionDto[];
}

export interface PlayerPredictionLookupResult {
  gameweek:     number | null;
  modelVersion: string | null;
  byPlayerId:   Map<number, PlayerPredictionDto>;
}