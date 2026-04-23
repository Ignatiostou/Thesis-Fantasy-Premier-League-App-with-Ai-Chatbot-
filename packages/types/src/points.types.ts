import type { ChipType } from './enums';


export interface UserGameweekScore {
  id:           string;
  userTeamId:   string;
  gameweek:     number;
  /** Raw GW points before captain multiplier and hit deductions */
  points:       number;
  /** Final GW points after captain multiplier, chip effects, hit deductions */
  totalPoints:  number;
  transferHits: number;
  benchPoints:  number;
  /** Rank among all managers for this specific GW */
  rank:         number | null;
  chipPlayed:   ChipType | null;
}

/** Returned by GET /points/history — season history for charts */
export interface PointsHistoryResponse {
  season:     string;
  totalScore: number;
  overallRank: number | null;
  gameweeks:  UserGameweekScore[];
}

/** Returned by GET /points/live/:gameweek — live GW scoring */
export interface LiveGwResponse {
  gameweek:      number;
  isLive:        boolean;
  userPoints:    number;
  avgPoints:     number;
  topPoints:     number;
  picks:         LivePickScore[];
}

export interface LivePickScore {
  playerId:    number;
  webName:     string;
  teamShort:   string;
  position:    number;   // squad position 1-15
  isCaptain:   boolean;
  isViceCap:   boolean;
  isOnBench:   boolean;
  livePoints:  number;   // points scored so far this GW
  finalPoints: number;   // points counting (×2 for captain etc)
  isPlaying:   boolean;  // currently in a match
  minutes:     number;
}

// ── FPL Scoring Rules ─────────────────────────────────────────────────────────
// These are used by both the scoring service (api) and the UI (web).
// Keeping them here avoids duplicating the constants.

export const SCORING_RULES = {
  // Minutes played
  MINUTES_60_PLUS:   2,
  MINUTES_1_TO_59:   1,

  // Goals scored
  GK_DEF_GOAL:       6,
  MID_GOAL:          5,
  FWD_GOAL:          4,

  // Assists
  ASSIST:            3,

  // Clean sheets
  GK_DEF_CLEAN_SHEET: 4,
  MID_CLEAN_SHEET:    1,

  // Goals conceded
  GK_DEF_GOALS_CONCEDED_2: -1,  // every 2 goals conceded

  // Saves
  GK_SAVES_3:        1,          // per 3 saves

  // Cards & penalties
  YELLOW_CARD:       -1,
  RED_CARD:          -3,
  PENALTY_MISS:      -2,
  PENALTY_SAVE:       5,
  OWN_GOAL:          -2,

  // Bonus
  BONUS_3:            3,
  BONUS_2:            2,
  BONUS_1:            1,

  // Transfer hit
  TRANSFER_HIT:      -4,
} as const;
