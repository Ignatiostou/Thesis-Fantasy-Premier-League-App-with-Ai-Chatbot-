// ── Shared ────────────────────────────────────────────────────────────────────

export interface FixtureSummary {
  gameweek:   number;
  opponent:   string;
  isHome:     boolean;
  difficulty: number;   // FDR 1-5
}

export interface PlayerSnapshot {
  id:                number;
  webName:           string;
  club:              string;
  position:          string;   // 'GK' | 'DEF' | 'MID' | 'FWD'
  nowCost:           number;   // tenths: 75 = £7.5m
  totalPoints:       number;
  form:              number;
  selectedByPercent: number;
  chanceOfPlaying:   number;   // 0-100
  status:            string;   // 'a' | 'd' | 'i' etc
  nextFixtures:      FixtureSummary[];
}



export type RecommendationHorizon = 'GW1' | 'GW3' | 'GW5' | 'SEASON';

export interface RecommendationExplanation {
  upside:       string;   // e.g. "+3.2 expected points vs. current captain"
  risk:         string;   // e.g. "30% chance of rotation; tough away fixture"
  horizon:      RecommendationHorizon;
  alternative:  string;   // e.g. "If you want a safer pick, consider <player>"
  confidence:   'HIGH' | 'MEDIUM' | 'LOW';
}



export interface RecommendationContextBlock {
  intent:     string;
  summary:    string;
  structured: Record<string, unknown> | null;
}



export interface CaptainCandidateSummary {
  playerId:     number;
  webName:      string;
  club:         string;
  position:     string;
  score:        number;
  reasons:      string[];
  risk:         string[];
  /** IMPROVEMENT #2: structured explanation guaranteed on every candidate, not just the top pick. */
  explanation:  RecommendationExplanation;
}

// Rich version used by recommendation.formatter.ts (for the RecommendationBlock pipeline)
export interface CaptainCandidate {
  player:           PlayerSnapshot;
  score:            number;
  fixtureRating:    number;
  formRating:       number;
  isInSquad:        boolean;
  isCurrentCaptain: boolean;
  reasoning:        string;
}

export interface CaptainRecommendation {
  intent:        'CAPTAINCY';
  gameweek:      number;
  candidates:    CaptainCandidate[];
  topPick:       CaptainCandidate;
  differential?: CaptainCandidate;
  /** IMPROVEMENT #2: explanation for the topPick specifically. */
  explanation?:  RecommendationExplanation;
}

// ── Player comparison ─────────────────────────────────────────────────────────
// Simple version used by player-comparison.service.ts → recommendation.service.ts

export interface PlayerComparisonPlayerData {
  playerId:                number;
  webName:                 string;
  club:                    string;
  position:                string;
  nowCost:                 number;
  totalPoints:              number;
  form:                    number | null;
  chanceOfPlayingNextRound:number | null;
  status:                  string;
  pros:                    string[];
  cons:                    string[];
}

export interface PlayerComparisonSimpleResult {
  found:           boolean;
  players:         PlayerComparisonPlayerData[];
  recommendation?: string;
  /** IMPROVEMENT #2 */
  explanation?:    RecommendationExplanation;
}

// Rich version used by recommendation.formatter.ts
export interface ComparisonDimension {
  label:   string;
  playerA: string | number;
  playerB: string | number;
  winner:  'A' | 'B' | 'DRAW';
}

export interface PlayerComparisonRichResult {
  intent:     'PLAYER_COMPARISON';
  playerA:    PlayerSnapshot;
  playerB:    PlayerSnapshot;
  dimensions: ComparisonDimension[];
  verdict:    'A' | 'B' | 'DRAW';
  reasoning:  string;
  priceDiff:  number;
  /** IMPROVEMENT #2 */
  explanation?: RecommendationExplanation;
}

// ── Transfer evaluation ───────────────────────────────────────────────────────
// Simple version used by transfer-evaluator.service.ts → recommendation.service.ts

export interface TransferEvaluationResult {
  detected:        boolean;
  outgoingPlayer:  {
    playerId:   number;
    webName:    string;
    club:       string;
    position:   string;
    sellPrice?: number;
  } | null;
  incomingPlayer: {
    playerId:                number;
    webName:                 string;
    club:                    string;
    position:                string;
    buyPrice:                number;
    totalPoints:             number;
    form:                    number | null;
    status:                  string;
    chanceOfPlayingNextRound:number | null;
  } | null;
  budgetImpact?: {
    bankBefore: number;
    bankAfter:  number;
    affordable: boolean;
  };
  ruleCheck?: {
    samePosition:      boolean;
    maxPerClubLikelyOk:boolean;
  };
  recommendation?: string;
  risks?:          string[];
  /** IMPROVEMENT #2 */
  explanation?:    RecommendationExplanation;
}

// Rich version used by recommendation.formatter.ts
export interface TransferOption {
  playerOut:               PlayerSnapshot;
  playerIn:                PlayerSnapshot;
  budgetImpact:            number;
  isAffordable:            boolean;
  positionMatch:           boolean;
  clubLimitOk:             boolean;
  pointsDelta:             number;
  fixtureSwing:            number;
  isHitRequired:           boolean;
  hitCost:                 number;
  netBenefit:              number;
  recommendationStrength:  'STRONG' | 'MODERATE' | 'WEAK' | 'AVOID';
}

export interface TransferEvaluation {
  intent:          'TRANSFER_ADVICE' | 'TRANSFER_EVALUATION';
  gameweek:        number;
  freeTransfers:   number;
  bank:            number;
  options:         TransferOption[];
  topOption:       TransferOption | null;
  hitAdvice:       'AVOID' | 'WORTH_IT' | 'BORDERLINE';
  hitAdviceReason: string;
  /** IMPROVEMENT #2 */
  explanation?:    RecommendationExplanation;
}

// ── RecommendationBlock ───────────────────────────────────────────────────────
// Used by recommendation.formatter.ts + assistant.prompts.ts

export interface RecommendationBlock {
  intent:      string;
  generatedAt: string;
  data:
    | CaptainRecommendation
    | PlayerComparisonRichResult
    | TransferEvaluation
    | null;
}
