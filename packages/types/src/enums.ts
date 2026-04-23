/** FPL player availability status from the bootstrap-static API */
export type PlayerStatus = 'a' | 'd' | 'i' | 's' | 'u';

/** Position code: 1=GK, 2=DEF, 3=MID, 4=FWD */
export type PositionId = 1 | 2 | 3 | 4;

export const POSITION_LABEL: Record<PositionId, string> = {
  1: 'GK',
  2: 'DEF',
  3: 'MID',
  4: 'FWD',
} as const;

export const POSITION_COLOR: Record<PositionId, string> = {
  1: '#facc15',  // GK  – yellow
  2: '#38bdf8',  // DEF – sky
  3: '#00FF87',  // MID – green
  4: '#f97316',  // FWD – orange
} as const;

// ── Chip type ──────────────────────────────────────────────────────────────

export const ChipType = {
  WILDCARD:       'WILDCARD',
  BENCH_BOOST:    'BENCH_BOOST',
  TRIPLE_CAPTAIN: 'TRIPLE_CAPTAIN',
  FREE_HIT:       'FREE_HIT',
} as const;

export type ChipType = (typeof ChipType)[keyof typeof ChipType];

export const CHIP_LABEL: Record<ChipType, string> = {
  WILDCARD:       'Wildcard',
  BENCH_BOOST:    'Bench Boost',
  TRIPLE_CAPTAIN: 'Triple Captain',
  FREE_HIT:       'Free Hit',
} as const;

export const CHIP_ICON: Record<ChipType, string> = {
  WILDCARD:       '🃏',
  BENCH_BOOST:    '⚡',
  TRIPLE_CAPTAIN: '👑',
  FREE_HIT:       '🎯',
} as const;

// ── League type ────────────────────────────────────────────────────────────

export const LeagueType = {
  CLASSIC:      'CLASSIC',
  HEAD_TO_HEAD: 'HEAD_TO_HEAD',
} as const;

export type LeagueType = (typeof LeagueType)[keyof typeof LeagueType];

export const LEAGUE_TYPE_LABEL: Record<LeagueType, string> = {
  CLASSIC:      'Classic',
  HEAD_TO_HEAD: 'Head to Head',
} as const;
