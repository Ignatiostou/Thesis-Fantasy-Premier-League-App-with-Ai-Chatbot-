import { prisma }          from '../../db/prisma.js';
import {
  getEditableGameweekId,
  getLiveGameweekId,
}                           from '../../utils/gameweek.js';
import { buildProfileSummary } from './onboarding.service.js';

const POSITION_LABEL: Record<number, string> = {
  1: 'GK',
  2: 'DEF',
  3: 'MID',
  4: 'FWD',
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UserContext {
  username:         string;
  gameweek:         number;
  liveGameweek:     number;
  hasTeam:          boolean;
  teamName:         string | null;
  budgetLeft:       string | null;
  freeTransfers:    number | null;
  activeChip:       string | null;
  profileSummary:   string | null;
  squad:            SquadPlayer[];
  recentScores:     GwScore[];
  upcomingFixtures: TeamFixture[];
  teamStats:        TeamSeasonStats[];   // ← NEW
}

interface SquadPlayer {
  webName:        string;
  position:       string;
  club:           string;
  nowCost:        string;
  seasonTotalPts: number;   
  form:           number | null;
  status:         string;
  isCaptain:      boolean;
  isViceCaptain:  boolean;
  isOnBench:      boolean;
  chanceOfPlaying: number | null;
}

interface GwScore {
  gameweek:    number;
  finalPoints: number;
}

interface TeamFixture {
  gameweek:   number;
  home:       string;
  away:       string;
  difficulty: number;
  kickoff:    string | null;
}

// ← NEW: per-team season defensive/offensive stats
interface TeamSeasonStats {
  teamName:      string;
  shortName:     string;
  cleanSheets:   number;
  goalsConceded: number;
  goalsScored:   number;
  gamesPlayed:   number;
}

function formatCost(tenths: number): string {
  return `£${(tenths / 10).toFixed(1)}m`;
}

// ── Team stats builder ────────────────────────────────────────────────────────
// Aggregates from player_gameweek_stats — uses GK rows (position=1) for
// defensive metrics since each GK represents their team in that GW.
// More reliable than trying to aggregate from fixture scores.

async function buildTeamStats(teamIds: number[]): Promise<TeamSeasonStats[]> {
  if (teamIds.length === 0) return [];

  // Get all teams in one query
  const teams = await prisma.fplTeam.findMany({
    where: { id: { in: teamIds } },
    select: { id: true, name: true, shortName: true },
  });

  // Get GK stats for defensive metrics (one GK entry per team per GW)
  // We use goalsConceded and cleanSheets from GK rows — reliable proxy for team
  const gkStats = await prisma.playerGameweekStat.findMany({
    where: {
      player: {
        position: 1, // GK only
        teamId:   { in: teamIds },
      },
    },
    select: {
      goalsConceded: true,
      cleanSheets:   true,
      goalsScored:   true,  // GK bonus goals (rare, but zero-fill ok)
      player: {
        select: { teamId: true },
      },
    },
  });

  // Get outfield goals scored per team
  const outfieldGoals = await prisma.playerGameweekStat.findMany({
    where: {
      player: {
        position: { in: [2, 3, 4] },
        teamId:   { in: teamIds },
      },
    },
    select: {
      goalsScored: true,
      gameweek:    true,
      player: { select: { teamId: true } },
    },
  });

  // Aggregate per team
  const teamMap = new Map(teams.map((t) => [t.id, { ...t, cleanSheets: 0, goalsConceded: 0, goalsScored: 0, gamesPlayed: 0 }]));

  for (const row of gkStats) {
    const t = teamMap.get(row.player.teamId);
    if (!t) continue;
    t.goalsConceded += row.goalsConceded;
    if (row.cleanSheets) t.cleanSheets += 1;
    t.gamesPlayed   += 1;
  }

  // Aggregate goals scored from outfield (per GW per team — deduplicated by gameweek)
  const goalsByTeamGw = new Map<string, number>();
  for (const row of outfieldGoals) {
    const key = `${row.player.teamId}:${row.gameweek}`;
    goalsByTeamGw.set(key, (goalsByTeamGw.get(key) ?? 0) + row.goalsScored);
  }
  for (const [key, goals] of goalsByTeamGw) {
    const teamId = parseInt(key.split(':')[0]);
    const t = teamMap.get(teamId);
    if (t) t.goalsScored += goals;
  }

  return Array.from(teamMap.values()).map((t) => ({
    teamName:      t.name,
    shortName:     t.shortName,
    cleanSheets:   t.cleanSheets,
    goalsConceded: t.goalsConceded,
    goalsScored:   t.goalsScored,
    gamesPlayed:   t.gamesPlayed,
  }));
}

// ── buildUserContext ──────────────────────────────────────────────────────────

export async function buildUserContext(userId: string): Promise<UserContext> {
  const [user, team, profile, liveGw, editableGw] = await Promise.all([
    prisma.user.findUnique({
      where:  { id: userId },
      select: { username: true },
    }),
    prisma.userTeam.findUnique({
      where:  { userId },
      select: { id: true, name: true, budget: true },
    }),
    prisma.userAssistantProfile.findUnique({ where: { userId } }),
    getLiveGameweekId(),
    getEditableGameweekId(),
  ]);

  const base: UserContext = {
    username:         user?.username ?? 'Manager',
    gameweek:         editableGw,
    liveGameweek:     liveGw,
    hasTeam:          !!team,
    teamName:         team?.name ?? null,
    budgetLeft:       team ? formatCost(team.budget) : null,
    freeTransfers:    null,
    activeChip:       null,
    profileSummary:   profile ? buildProfileSummary(profile) : null,
    squad:            [],
    recentScores:     [],
    upcomingFixtures: [],
    teamStats:        [],
  };

  if (!team) return base;

  const [picks, gwState, recentScores] = await Promise.all([
    prisma.userPick.findMany({
      where:   { userTeamId: team.id, gameweek: editableGw },
      orderBy: { position: 'asc' },
      include: { player: { include: { team: true } } },
    }),
    prisma.userGameweekState.findUnique({
      where: { userTeamId_gameweek: { userTeamId: team.id, gameweek: editableGw } },
    }),
    prisma.userGameweekScore.findMany({
      where:   { userTeamId: team.id },
      orderBy: { gameweek: 'desc' },
      take:    5,
      select:  { gameweek: true, finalPoints: true },
    }),
  ]);

  base.freeTransfers = gwState?.freeTransfers ?? 1;
  base.activeChip    = gwState?.activeChip ?? null;
  base.recentScores  = recentScores.map((s) => ({
    gameweek:    s.gameweek,
    finalPoints: s.finalPoints,
  }));

  base.squad = picks.map((pick) => ({
    webName:         pick.player.webName,
    position:        POSITION_LABEL[pick.player.position] ?? 'UNK',
    club:            pick.player.team.shortName,
    nowCost:         formatCost(pick.player.nowCost),
    seasonTotalPts:  pick.player.totalPoints ?? 0,   // renamed: explicit it's SEASON total
    form:            pick.player.form ?? null,
    status:          pick.player.status,
    isCaptain:       pick.isCaptain,
    isViceCaptain:   pick.isViceCaptain,
    isOnBench:       pick.isOnBench,
    chanceOfPlaying: pick.player.chanceOfPlayingNextRound ?? null,
  }));

  if (picks.length > 0) {
    const clubIds = [...new Set(picks.map((p) => p.player.teamId))];
    const nextGws = [editableGw, editableGw + 1, editableGw + 2].filter((g) => g <= 38);

    // Fetch fixtures AND team stats in parallel
    const [fixtures, teamStats] = await Promise.all([
      prisma.fplFixture.findMany({
        where: {
          event:    { in: nextGws },
          finished: false,
          OR: [
            { teamHId: { in: clubIds } },
            { teamAId: { in: clubIds } },
          ],
        },
        include:  { teamH: true, teamA: true },
        orderBy:  { kickoffTime: 'asc' },
        take:     20,
      }),
      buildTeamStats(clubIds),
    ]);

    base.upcomingFixtures = fixtures.map((f) => ({
      gameweek:   f.event ?? 0,
      home:       f.teamH.shortName,
      away:       f.teamA.shortName,
      difficulty: f.teamHDifficulty ?? 3,
      kickoff:    f.kickoffTime?.toISOString() ?? null,
    }));

    base.teamStats = teamStats;
  }

  return base;
}

// ── formatContextForPrompt ────────────────────────────────────────────────────

export function formatContextForPrompt(ctx: UserContext): string {
  const lines: string[] = [
    `=== MANAGER CONTEXT ===`,
    `Manager: ${ctx.username}`,
    `Current Gameweek (editable): GW${ctx.gameweek}`,
    `Live Gameweek: GW${ctx.liveGameweek}`,
  ];

  if (!ctx.hasTeam) {
    lines.push(`Team: Not yet created — user is building their initial squad.`);
    return lines.join('\n');
  }

  lines.push(`Team: ${ctx.teamName}`);
  lines.push(`Bank: ${ctx.budgetLeft}`);
  lines.push(`Free Transfers: ${ctx.freeTransfers}`);

  if (ctx.activeChip) lines.push(`Active Chip: ${ctx.activeChip}`);

  if (ctx.recentScores.length > 0) {
    const scoreStr = ctx.recentScores
      .map((s) => `GW${s.gameweek}: ${s.finalPoints}pts`)
      .join(', ');
    lines.push(`Recent Scores: ${scoreStr}`);
  }

  if (ctx.squad.length > 0) {
    lines.push(`\n=== CURRENT SQUAD ===`);
    lines.push(`(NOTE: "Season pts" = cumulative total for the whole season, NOT a per-gameweek score.`);
    lines.push(` Use "form" and ML xPts as the primary indicators of current performance.)`);

    const starters = ctx.squad.filter((p) => !p.isOnBench);
    const bench    = ctx.squad.filter((p) => p.isOnBench);

    lines.push('Starting XI:');
    for (const p of starters) {
      const flags = [
        p.isCaptain     ? '(C)'  : '',
        p.isViceCaptain ? '(VC)' : '',
        p.status !== 'a'                                           ? `[${p.status.toUpperCase()}]`      : '',
        p.chanceOfPlaying !== null && p.chanceOfPlaying < 75      ? `(${p.chanceOfPlaying}% chance)`   : '',
        p.chanceOfPlaying !== null && p.chanceOfPlaying < 50      ? `⚠️ LOW AVAILABILITY`               : '',
      ].filter(Boolean).join(' ');

      lines.push(
        `  ${p.position} | ${p.webName} (${p.club}) | ${p.nowCost} | season: ${p.seasonTotalPts}pts | form: ${p.form ?? 'N/A'} ${flags}`,
      );
    }

    lines.push('Bench:');
    for (const p of bench) {
      lines.push(
        `  ${p.position} | ${p.webName} (${p.club}) | ${p.nowCost} | season: ${p.seasonTotalPts}pts | form: ${p.form ?? 'N/A'}`,
      );
    }
  }

  if (ctx.upcomingFixtures.length > 0) {
    lines.push(`\n=== UPCOMING FIXTURES (next 3 GWs for your clubs) ===`);
    lines.push(`(difficulty: 1=easiest, 5=hardest from the perspective of the home team)`);
    for (const f of ctx.upcomingFixtures.slice(0, 12)) {
      lines.push(`  GW${f.gameweek}: ${f.home} vs ${f.away} (diff: ${f.difficulty}/5)`);
    }
  }

  // ← NEW: team defensive/offensive stats section
  if (ctx.teamStats.length > 0) {
    lines.push(`\n=== TEAM DEFENSIVE & OFFENSIVE STATS (season) ===`);
    lines.push(`(Use these to recommend defenders from the best defences and assess attack quality.)`);
    lines.push(`(Lower goals conceded = better defence. Higher clean sheets = more likely to blank.)`);

    // Sort by goals conceded ascending (best defence first)
    const sorted = [...ctx.teamStats].sort((a, b) => {
      if (a.gamesPlayed === 0 || b.gamesPlayed === 0) return 0;
      const aRate = a.goalsConceded / a.gamesPlayed;
      const bRate = b.goalsConceded / b.gamesPlayed;
      return aRate - bRate;
    });

    for (const t of sorted) {
      if (t.gamesPlayed === 0) continue;
      const gcPg = (t.goalsConceded / t.gamesPlayed).toFixed(2);
      const gsPg = (t.goalsScored   / t.gamesPlayed).toFixed(2);
      lines.push(
        `  ${t.shortName.padEnd(4)} | ${t.cleanSheets} clean sheets | ` +
        `${t.goalsConceded} conceded (${gcPg}/gm) | ` +
        `${t.goalsScored} scored (${gsPg}/gm)`,
      );
    }
  }

  if (ctx.profileSummary) {
    lines.push(`\n=== MANAGER PROFILE ===`);
    lines.push(ctx.profileSummary);
  }

  return lines.join('\n');
}