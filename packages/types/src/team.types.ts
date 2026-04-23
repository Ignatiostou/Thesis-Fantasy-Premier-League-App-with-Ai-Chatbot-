import type { ChipType } from './enums';
import type { FplPlayerWithTeam } from './fpl.types';

// ── User Team ─────────────────────────────────────────────────────────────────

export interface UserTeam {
  id:        string;
  userId:    string;
  name:      string;   // "Hawk United FC"
  budget:    number;   // remaining budget in tenths of £m  (e.g. 50 = £5.0m)
  season:    string;   // "2024-25"
  createdAt: string;
  updatedAt: string;
}

// ── Picks ─────────────────────────────────────────────────────────────────────

/** A single slot in the 15-man squad for a given gameweek */
export interface UserPick {
  id:            string;
  userTeamId:    string;
  playerId:      number;
  teamId:        number;
  gameweek:      number;
  /** 1–11 = starting XI, 12–15 = bench (12 = first sub, 15 = last) */
  position:      number;
  isCaptain:     boolean;
  isViceCaptain: boolean;
  isOnBench:     boolean;
  benchOrder:   number | null;  // 1-4 for bench players, null for starters
  buyPrice:     number;         // in tenths of £m e.g. 75 = £7.5m
}

/** Pick with the full player + club data embedded — used in the squad UI */
export interface UserPickWithPlayer extends UserPick {
  player: FplPlayerWithTeam;
  /** Points scored this gameweek (doubled if captain) */
  gwPoints: number | null;
}

/** The full squad response returned by GET /team/picks/:gameweek */
export interface SquadResponse {
  userTeam:         UserTeam;
  gameweek:         number;
  picks:            UserPickWithPlayer[];
  totalGwPoints:    number;
  transfersLeft:    number;
  activeChip:       ChipType | null;
}

// ── Create / update squad body ────────────────────────────────────────────────

export interface PickInput {
  playerId:      number;
  position:      number;
  isCaptain:     boolean;
  isViceCaptain: boolean;
}

/** POST /team/picks  — save the full squad for a gameweek */
export interface SavePicksBody {
  gameweek: number;
  picks:    PickInput[];   // must be exactly 15
}

// ── Transfers ─────────────────────────────────────────────────────────────────

export interface UserTransfer {
  id:            string;
  userTeamId:    string;
  gameweek:      number;
  playerInId:    number;
  playerOutId:   number;
  playerInCost:  number;
  playerOutCost: number;
  isHit:         boolean;
  createdAt:     string;
}

/** Transfer with player data embedded — used in transfer history UI */
export interface UserTransferWithPlayers extends UserTransfer {
  playerIn:  FplPlayerWithTeam;
  playerOut: FplPlayerWithTeam;
}

/** POST /team/transfers — make one or more transfers */
export interface MakeTransfersBody {
  transfers: Array<{
    inPlayerId:  number;
    outPlayerId: number;
  }>;
  /** If true, user accepts the point hit for extra transfers */
  activateChip?: 'wildcard' | null;  // optional override to activate a chip instead of taking hits
}

/** Returned by GET /team/transfers/status */
export interface TransferStatusResponse {
  freeTransfers:   number;  // 1 or 2
  transfersMade:   number;  // this GW so far
  hitCost:         number;  // total point deduction pending
  bank:            number;  // current bank (tenths of £m)
}

// ── Chips ─────────────────────────────────────────────────────────────────────

export interface UserChip {
  id:         string;
  userTeamId: string;
  chip:       ChipType;
  gameweek:   number;
  playedAt:   string;
}

/** POST /team/chips — activate a chip for the current gameweek */
export interface PlayChipBody {
  chip:     ChipType;
  gameweek: number;
}

/** Returned by GET /team/chips */
export interface ChipsStatusResponse {
  chips: Array<{
    chip:      ChipType;
    available: boolean;
    gameweek:  number | null;   // null if not yet played
  }>;
}

// ── Squad validation errors ───────────────────────────────────────────────────

export type SquadValidationError =
  | 'BUDGET_EXCEEDED'         // total cost > £100m
  | 'INVALID_FORMATION'       // doesn't meet min formation rules
  | 'CLUB_LIMIT_EXCEEDED'     // more than 3 players from same club
  | 'WRONG_SQUAD_SIZE'        // not exactly 15 players
  | 'DUPLICATE_PLAYER'        // same player appears twice
  | 'INVALID_CAPTAIN'         // captain not in starting XI
  | 'DEADLINE_PASSED'         // gameweek deadline has passed
  | 'CHIP_ALREADY_USED'       // chip has already been played
  | 'POSITION_MISMATCH'       // position doesn't match player's actual position (e.g. 1 = GK, 2 = DEF etc)
  | 'WILDCARD_NOT_AVAILABLE'  // trying to activate wildcard when it's not available
  | 'NO_TEAM';                // user doesn't have a team yet (e.g. new user)

// ── Transfer validation errors ────────────────────────────────────────────────
