// apps/api/src/modules/ai/recommendation.types.ts
// Types for the recommendation engines.
// Contains BOTH the rich types (used by recommendation.formatter.ts)
// AND the simple types (used by the specialized services).

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

// ── RecommendationContextBlock ────────────────────────────────────────────────
// What recommendation.service.ts returns to assistant.service.ts.
// summary  = human-readable text injected into the prompt
// structured = raw data saved in RecommendationLog.payload

export interface RecommendationContextBlock {
  intent:     string;
  summary:    string;
  structured: Record<string, unknown> | null;
}

// ── Captain recommendation ────────────────────────────────────────────────────
// Used by captaincy.service.ts → recommendation.service.ts

export interface CaptainCandidateSummary {
  playerId:  number;
  webName:   string;
  club:      string;
  position:  string;
  score:     number;
  reasons:   string[];
  risk:      string[];
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
}

// ── Player comparison ─────────────────────────────────────────────────────────
// Simple version used by player-comparison.service.ts → recommendation.service.ts

export interface PlayerComparisonPlayerData {
  playerId:                number;
  webName:                 string;
  club:                    string;
  position:                string;
  nowCost:                 number;
  totalPoints:             number;
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