import { prisma } from '../../db/prisma.js';

function generateLeagueCode(length = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

async function generateUniqueLeagueCode() {
  for (let i = 0; i < 20; i++) {
    const code = generateLeagueCode();
    const existing = await prisma.league.findUnique({
      where: { code },
    });
    if (!existing) return code;
  }

  throw new Error('FAILED_TO_GENERATE_LEAGUE_CODE');
}

async function getUserTeamOrThrow(userId: string) {
  const team = await prisma.userTeam.findUnique({
    where: { userId },
  });

  if (!team) throw new Error('NO_TEAM');

  return team;
}

export async function getMyLeagues(userId: string) {
  const memberships = await prisma.leagueMember.findMany({
    where: { userId },
    include: {
      league: true,
    },
    orderBy: {
      joinedAt: 'desc',
    },
  });

  return {
    items: memberships.map((m) => ({
      id: m.league.id,
      name: m.league.name,
      code: m.league.code,
      type: m.league.type,
      joinedAt: m.joinedAt,
    })),
  };
}

export async function createLeague(userId: string, name: string) {
  if (!name?.trim()) throw new Error('LEAGUE_NAME_REQUIRED');

  const team = await getUserTeamOrThrow(userId);
  const code = await generateUniqueLeagueCode();

  const league = await prisma.$transaction(async (tx) => {
    const created = await tx.league.create({
      data: {
        name: name.trim(),
        code,
        type: 'CLASSIC',
        adminUserId: userId,
      },
    });

    await tx.leagueMember.create({
      data: {
        leagueId: created.id,
        userId,
        userTeamId: team.id,
      },
    });

    return created;
  });

  return league;
}

export async function joinLeague(userId: string, code: string) {
  if (!code?.trim()) throw new Error('LEAGUE_CODE_REQUIRED');

  const team = await getUserTeamOrThrow(userId);

  const league = await prisma.league.findUnique({
    where: { code: code.trim().toUpperCase() },
  });

  if (!league) throw new Error('LEAGUE_NOT_FOUND');

  const existing = await prisma.leagueMember.findUnique({
    where: {
      leagueId_userId: {
        leagueId: league.id,
        userId,
      },
    },
  });

  if (existing) throw new Error('ALREADY_IN_LEAGUE');

  await prisma.leagueMember.create({
    data: {
      leagueId: league.id,
      userId,
      userTeamId: team.id,
    },
  });

  return {
    success: true,
    leagueId: league.id,
  };
}

export async function leaveLeague(userId: string, leagueId: string) {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
  });

  if (!league) throw new Error('LEAGUE_NOT_FOUND');

  const membership = await prisma.leagueMember.findUnique({
    where: {
      leagueId_userId: {
        leagueId,
        userId,
      },
    },
  });

  if (!membership) throw new Error('NOT_IN_LEAGUE');

  const membersCount = await prisma.leagueMember.count({
    where: { leagueId },
  });

  await prisma.$transaction(async (tx) => {
    await tx.leagueMember.delete({
      where: {
        leagueId_userId: {
          leagueId,
          userId,
        },
      },
    });

    if (membersCount === 1) {
      await tx.league.delete({
        where: { id: leagueId },
      });
      return;
    }

    if (league.adminUserId === userId) {
      const nextAdmin = await tx.leagueMember.findFirst({
        where: { leagueId },
        orderBy: { joinedAt: 'asc' },
      });

      if (nextAdmin) {
        await tx.league.update({
          where: { id: leagueId },
          data: { adminUserId: nextAdmin.userId },
        });
      }
    }
  });

  return { success: true };
}

export async function getLeagueDetails(userId: string, leagueId: string) {
  const membership = await prisma.leagueMember.findUnique({
    where: {
      leagueId_userId: {
        leagueId,
        userId,
      },
    },
    include: {
      league: true,
    },
  });

  if (!membership) throw new Error('LEAGUE_NOT_FOUND_OR_NO_ACCESS');

  const membersCount = await prisma.leagueMember.count({
    where: { leagueId },
  });

  return {
    id: membership.league.id,
    name: membership.league.name,
    code: membership.league.code,
    type: membership.league.type,
    adminUserId: membership.league.adminUserId,
    membersCount,
    createdAt: membership.league.createdAt,
  };
}

export async function getLeagueStandings(userId: string, leagueId: string) {
  const membership = await prisma.leagueMember.findUnique({
    where: {
      leagueId_userId: {
        leagueId,
        userId,
      },
    },
  });

  if (!membership) throw new Error('LEAGUE_NOT_FOUND_OR_NO_ACCESS');

  const members = await prisma.leagueMember.findMany({
    where: { leagueId },
    include: {
      user: {
        select: {
          id: true,
          username: true,
        },
      },
      userTeam: {
        select: {
          id: true,
          name: true,
          scores: {
            select: {
              gameweek: true,
              finalPoints: true,
            },
          },
        },
      },
    },
    orderBy: {
      joinedAt: 'asc',
    },
  });

  const rows = members.map((m) => {
    const totalPoints = m.userTeam.scores.reduce((sum, s) => sum + s.finalPoints, 0);
    const latestGw = m.userTeam.scores.length
      ? Math.max(...m.userTeam.scores.map((s) => s.gameweek))
      : null;
    const latestGwPoints = latestGw
      ? m.userTeam.scores.find((s) => s.gameweek === latestGw)?.finalPoints ?? 0
      : 0;

    return {
      userId: m.user.id,
      username: m.user.username,
      teamId: m.userTeam.id,
      teamName: m.userTeam.name,
      totalPoints,
      latestGwPoints,
      joinedAt: m.joinedAt,
    };
  });

  rows.sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    if (b.latestGwPoints !== a.latestGwPoints) return b.latestGwPoints - a.latestGwPoints;
    return a.joinedAt.getTime() - b.joinedAt.getTime();
  });

  return {
    items: rows.map((row, idx) => ({
      rank: idx + 1,
      userId: row.userId,
      username: row.username,
      teamId: row.teamId,
      teamName: row.teamName,
      totalPoints: row.totalPoints,
      latestGwPoints: row.latestGwPoints,
    })),
  };
}