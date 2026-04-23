import type { PositionId, PlayerStatus } from './enums';

// ── FPL Team (Premier League club) ────────────────────────────────────────────

export interface FplTeam {
  id:        number;
  name:      string;
  shortName: string;
  code:      number | null;
}

// ── FPL Player ────────────────────────────────────────────────────────────────

export interface FplPlayer {
  id:                       number;
  webName:                  string;
  firstName:                string;
  secondName:               string;
  teamId:                   number;
  position:                 PositionId;
  nowCost:                  number;   // e.g. 75 = £7.5m
  status:                   PlayerStatus;
  chanceOfPlayingNextRound: number | null;
  totalPoints:              number | null;
  minutes:                  number | null;
}

/** FplPlayer with the team object embedded — used in list/search responses */
export interface FplPlayerWithTeam extends FplPlayer {
  team: FplTeam;
}

/** FplPlayer with current GW stats embedded */
export interface FplPlayerWithStats extends FplPlayerWithTeam {
  gwStat: PlayerGameweekStat | null;
}

// ── FPL Event (Gameweek) ──────────────────────────────────────────────────────

export interface FplEvent {
  id:           number;   // 1-38
  name:         string;   // "Gameweek 1"
  deadlineTime: string | null;   // ISO date string
  finished:     boolean | null;
  isCurrent:    boolean | null;
}

// ── FPL Fixture ───────────────────────────────────────────────────────────────

export interface FplFixture {
  id:               number;
  event:            number | null;
  kickoffTime:      string | null;  // ISO date string
  teamHId:          number;
  teamAId:          number;
  teamHScore:       number | null;
  teamAScore:       number | null;
  teamHDifficulty:  number | null;  // 1-5
  teamADifficulty:  number | null;
  finished:         boolean | null;
  started:          boolean | null;
}

/** Fixture with both team objects embedded */
export interface FplFixtureWithTeams extends FplFixture {
  teamH: FplTeam;
  teamA: FplTeam;
}

// ── Player Gameweek Stats ─────────────────────────────────────────────────────

export interface PlayerGameweekStat {
  id:               string;
  playerId:         number;
  gameweek:         number;
  minutes:          number;
  goals:            number;
  assists:          number;
  cleanSheet:       boolean;
  goalsConceded:    number;
  ownGoals:         number;
  penaltiesSaved:   number;
  penaltiesMissed:  number;
  yellowCards:      number;
  redCards:         number;
  saves:            number;
  bonus:            number;
  bps:              number;
  totalPoints:      number;
  inDreamteam:      boolean;
}
