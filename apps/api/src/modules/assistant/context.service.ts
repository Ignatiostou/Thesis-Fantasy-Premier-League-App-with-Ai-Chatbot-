// apps/api/src/modules/ai/context.service.ts

import { prisma } from '../../db/prisma.js';
import { getEditableGameweekId, getLiveGameweekId } from '../../utils/gameweek.js';
import { buildProfileSummary } from './onboarding.service.js';

const POSITION_LABEL: Record<number, string> = {
  1: 'GK',
  2: 'DEF',
  3: 'MID',
  4: 'FWD',
};

export interface UserContext {
  username: string;
  gameweek: number;
  liveGameweek: number;
  hasTeam: boolean;
  teamName: string | null;
  budgetLeft: string | null;
  freeTransfers: number | null;
  activeChip: string | null;
  profileSummary: string | null;
  squad: SquadPlayer[];
  recentScores: GwScore[];
  upcomingFixtures: TeamFixture[];
}

interface SquadPlayer {
  webName: string;
  position: string;
  club: string;
  nowCost: string;
  totalPoints: number;
  form: number | null;
  status: string;
  isCaptain: boolean;
  isViceCaptain: boolean;
  isOnBench: boolean;
  chanceOfPlaying: number | null;
}

interface GwScore {
  gameweek: number;
  finalPoints: number;
}

interface TeamFixture {
  gameweek: number;
  home: string;
  away: string;
  difficulty: number;
  kickoff: string | null;
}

function formatCost(tenths: number): string {
  return `£${(tenths / 10).toFixed(1)}m`;
}

export async function buildUserContext(userId: string): Promise<UserContext> {
  const [user, team, profile, liveGw, editableGw] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { username: true },
    }),
    prisma.userTeam.findUnique({
      where: { userId },
      select: { id: true, name: true, budget: true },
    }),
    prisma.userAssistantProfile.findUnique({
      where: { userId },
    }),
    getLiveGameweekId(),
    getEditableGameweekId(),
  ]);

  const base: UserContext = {
    username: user?.username ?? 'Manager',
    gameweek: editableGw,
    liveGameweek: liveGw,
    hasTeam: !!team,
    teamName: team?.name ?? null,
    budgetLeft: team ? formatCost(team.budget) : null,
    freeTransfers: null,
    activeChip: null,
    profileSummary: profile ? buildProfileSummary(profile) : null,
    squad: [],
    recentScores: [],
    upcomingFixtures: [],
  };

  if (!team) return base;

  const [picks, gwState, recentScores] = await Promise.all([
    prisma.userPick.findMany({
      where: { userTeamId: team.id, gameweek: editableGw },
      orderBy: { position: 'asc' },
      include: {
        player: { include: { team: true } },
      },
    }),
    prisma.userGameweekState.findUnique({
      where: {
        userTeamId_gameweek: {
          userTeamId: team.id,
          gameweek: editableGw,
        },
      },
    }),
    prisma.userGameweekScore.findMany({
      where: { userTeamId: team.id },
      orderBy: { gameweek: 'desc' },
      take: 5,
      select: { gameweek: true, finalPoints: true },
    }),
  ]);

  base.freeTransfers = gwState?.freeTransfers ?? 1;
  base.activeChip = gwState?.activeChip ?? null;
  base.recentScores = recentScores.map((s) => ({
    gameweek: s.gameweek,
    finalPoints: s.finalPoints,
  }));

  base.squad = picks.map((pick) => ({
    webName: pick.player.webName,
    position: POSITION_LABEL[pick.player.position] ?? 'UNK',
    club: pick.player.team.shortName,
    nowCost: formatCost(pick.player.nowCost),
    totalPoints: pick.player.totalPoints ?? 0,
    form: pick.player.form ?? null,
    status: pick.player.status,
    isCaptain: pick.isCaptain,
    isViceCaptain: pick.isViceCaptain,
    isOnBench: pick.isOnBench,
    chanceOfPlaying: pick.player.chanceOfPlayingNextRound ?? null,
  }));

  if (picks.length > 0) {
    const clubIds = [...new Set(picks.map((p) => p.player.teamId))];
    const nextGws = [editableGw, editableGw + 1, editableGw + 2].filter((g) => g <= 38);

    const fixtures = await prisma.fplFixture.findMany({
      where: {
        event: { in: nextGws },
        finished: false,
        OR: [
          { teamHId: { in: clubIds } },
          { teamAId: { in: clubIds } },
        ],
      },
      include: { teamH: true, teamA: true },
      orderBy: { kickoffTime: 'asc' },
      take: 20,
    });

    base.upcomingFixtures = fixtures.map((f) => ({
      gameweek: f.event ?? 0,
      home: f.teamH.shortName,
      away: f.teamA.shortName,
      difficulty: f.teamHDifficulty ?? 3,
      kickoff: f.kickoffTime?.toISOString() ?? null,
    }));
  }

  return base;
}

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
    const starters = ctx.squad.filter((p) => !p.isOnBench);
    const bench = ctx.squad.filter((p) => p.isOnBench);

    lines.push('Starting XI:');
    for (const p of starters) {
      const flags = [
        p.isCaptain ? '(C)' : '',
        p.isViceCaptain ? '(VC)' : '',
        p.status !== 'a' ? `[${p.status.toUpperCase()}]` : '',
        p.chanceOfPlaying !== null && p.chanceOfPlaying < 75 ? `(${p.chanceOfPlaying}% chance)` : '',
      ].filter(Boolean).join(' ');

      lines.push(
        `  ${p.position} | ${p.webName} (${p.club}) | ${p.nowCost} | ${p.totalPoints}pts | form: ${p.form ?? 'N/A'} ${flags}`,
      );
    }

    lines.push('Bench:');
    for (const p of bench) {
      lines.push(
        `  ${p.position} | ${p.webName} (${p.club}) | ${p.nowCost} | ${p.totalPoints}pts`,
      );
    }
  }

  if (ctx.upcomingFixtures.length > 0) {
    lines.push(`\n=== UPCOMING FIXTURES (next 3 GWs for your clubs) ===`);
    for (const f of ctx.upcomingFixtures.slice(0, 12)) {
      lines.push(`  GW${f.gameweek}: ${f.home} vs ${f.away} (diff: ${f.difficulty}/5)`);
    }
  }

  if (ctx.profileSummary) {
    lines.push(`\n=== MANAGER PROFILE ===`);
    lines.push(ctx.profileSummary);
  }

  return lines.join('\n');
}