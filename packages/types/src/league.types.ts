// ─────────────────────────────────────────────────────────────────────────────
// league.types.ts
// Types for leagues, standings, and H2H matches.
// ─────────────────────────────────────────────────────────────────────────────

import type { LeagueType } from './enums';
import type { PublicUser } from './user.types';

// ── League ────────────────────────────────────────────────────────────────────

export interface League {
  id:         string;
  name:       string;
  code:       string;   // invite code e.g. "HAWK-2025"
  type:       LeagueType;
  adminId:    string;
  maxMembers: number;
  season:     string;
  createdAt:  string;
  updatedAt:  string;
}

export interface LeagueWithAdmin extends League {
  admin: PublicUser;
}

// ── Create / join ─────────────────────────────────────────────────────────────

/** POST /leagues — create a new league */
export interface CreateLeagueBody {
  name:       string;
  type:       LeagueType;
  maxMembers?: number;
}

/** POST /leagues/join — join via invite code */
export interface JoinLeagueBody {
  code: string;
}

// ── Standings ─────────────────────────────────────────────────────────────────

/** One row in a Classic league standings table */
export interface ClassicStandingRow {
  rank:           number;
  previousRank:   number | null;
  userId:         string;
  username:       string;
  teamName:       string;
  totalPoints:    number;
  gwPoints:       number;     // points this gameweek
  /** How many places moved vs last GW — positive = up, negative = down */
  rankMovement:   number;
}

/** One row in an H2H league standings table */
export interface H2HStandingRow extends ClassicStandingRow {
  won:    number;
  drawn:  number;
  lost:   number;
  /** W×3 + D×1 */
  h2hPoints: number;
}

/** Returned by GET /leagues/:id/standings */
export interface StandingsResponse {
  league:   LeagueWithAdmin;
  gameweek: number;
  standings: ClassicStandingRow[] | H2HStandingRow[];
}

// ── H2H Matches ───────────────────────────────────────────────────────────────

export interface H2HMatch {
  id:         string;
  leagueId:   string;
  gameweek:   number;
  homeUserId: string;
  awayUserId: string;
  homePts:    number;
  awayPts:    number;
  winnerId:   string | null;  // null = draw
}

export interface H2HMatchWithUsers extends H2HMatch {
  homeUser: PublicUser & { teamName: string };
  awayUser: PublicUser & { teamName: string };
}

/** Returned by GET /leagues/:id/h2h/:gameweek */
export interface H2HGameweekResponse {
  gameweek: number;
  matches:  H2HMatchWithUsers[];
}
