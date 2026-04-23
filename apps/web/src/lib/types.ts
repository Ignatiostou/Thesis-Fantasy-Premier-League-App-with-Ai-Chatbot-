export interface Me {
  id: string;
  username: string;
  email: string;
}

export interface FplTeamInfo {
  id: number;
  name: string;
  shortName: string;
}

export interface FplEvent {
  id: number;
  name: string;
  deadlineTime: string | null;
  isCurrent: boolean | null;
  finished: boolean | null;
}

export interface FplFixture {
  id: number;
  kickoffTime: string | null;
  teamH: { name: string; shortName: string };
  teamA: { name: string; shortName: string };
  teamHScore: number | null;
  teamAScore: number | null;
  started: boolean | null;
  finished: boolean | null;
}

export interface TeamPlayer {
  id: number;
  playerId: number;
  webName: string;
  position: 1 | 2 | 3 | 4;
  nowCost: number;
  buyPrice?: number;
  status: string;
  totalPoints: number;
  eventPoints: number | null;
  chanceOfPlayingNextRound: number | null;
  isCaptain: boolean;
  isViceCaptain: boolean;
  isOnBench: boolean;
  benchOrder: number | null;
  team: FplTeamInfo;
}

export interface UserTeam {
  id: number | string;
  name: string;
  budget?: number;
  budgetLeft?: number;
  totalPoints: number;
  overallRank: number | null;
  gameweek: number;
  season?: string;
  activeChip: string | null;
  picks: TeamPlayer[];
}

export interface ChipAvailability {
  WILDCARD: boolean;
  BENCH_BOOST: boolean;
  TRIPLE_CAPTAIN: boolean;
  FREE_HIT: boolean;
}

export interface GwState {
  freeTransfers: number;
  transfersMade: number;
  pointsHit: number;
  activeChip: string | null;
  wildcardAvailable?: boolean;
}

export interface League {
  id: string;
  name: string;
  code: string;
  type: "CLASSIC" | "HEAD_TO_HEAD";
  joinedAt?: string;
}

export interface LeagueDetail extends League {
  adminUserId: string;
  membersCount: number;
  createdAt: string;
}

export interface StandingRow {
  rank: number;
  userId: string;
  username: string;
  teamId: string;
  teamName: string;
  totalPoints: number;
  latestGwPoints: number;
}

export interface PickBreakdown {
  playerId: number;
  webName: string;
  teamShortName: string;
  position: number;
  minutes: number;
  basePoints: number;
  multiplier: number;
  finalPoints: number;
  counted: boolean;
  wasAutoSubbedIn: boolean;
  wasAutoSubbedOut: boolean;
  isCaptain: boolean;
  isViceCaptain: boolean;
  isOnBench: boolean;
}

export interface LiveScore {
  id?: string;
  gameweek: number;
  pointsBeforeHits: number;
  finalPoints: number;
  transferHits: number;
  pointsHit: number;
  benchPoints: number;
  captainPlayerId: number | null;
  viceCaptainPlayerId: number | null;
  chipPlayed: string | null;
  breakdown: PickBreakdown[];
}

export interface LiveSnapshot {
  gameweek: number;
  finished: boolean;
  team: { id: string; name: string };
  score: LiveScore;
  picks: any[];
  polledAt: string;
  nextPollInMs: number;
}

export interface HistoryScore {
  id: string;
  gameweek: number;
  pointsBeforeHits: number;
  finalPoints: number;
  transferHits: number;
  pointsHit: number;
  benchPoints: number;
  chipPlayed: string | null;
}

export interface SpinnerProps {
  size?: number;
  label?: string;
  fullScreen?: boolean;
}

export interface SlotProps {
  player: TeamPlayer;
  subSrc: TeamPlayer | null;
  subMode: boolean;
  benchBoost: boolean;
  onClick: (player: TeamPlayer, e: React.MouseEvent) => void;
  onDragStart?: (player: TeamPlayer, e: React.DragEvent) => void;
  onDragOver?: (player: TeamPlayer, e: React.DragEvent) => void;
  onDragLeave?: (player: TeamPlayer, e: React.DragEvent) => void;
  onDrop?: (player: TeamPlayer, e: React.DragEvent) => void;
  onDragEnd?: () => void;
  isDragging?: boolean;
  isDragOver?: boolean;
}

export interface Props {
  player: TeamPlayer;
  x: number;
  y: number;
  onAction: (action: string, player: TeamPlayer) => void;
}

export interface ChipCardProps {
  id: string;
  name: string;
  desc: string;
  icon: string;
  active: boolean;
  used: boolean;
  onToggle: () => void;
}

export interface DeadlineHeroProps {
  iso: string | null;
  label: string;
  gwName: string;
}

export interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
  warn?: boolean;
  href?: string;
}