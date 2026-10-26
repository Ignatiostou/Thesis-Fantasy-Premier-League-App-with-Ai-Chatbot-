import { prisma } from "../../db/prisma.js";
import {
  type PlayerStatsMap,
  type PickWithRelations,
  type GwStateLite,
  calculateSingleTeamScore,
} from "./scoring.helpers.js";

async function getCurrentGameweekId() {
  const current = await prisma.fplEvent.findFirst({
    where: { isCurrent: true },
    select: { id: true },
  });

  return current?.id ?? 1;
}

async function ensureGameweekState(userTeamId: string, gameweek: number) {
  const existing = await prisma.userGameweekState.findUnique({
    where: {
      userTeamId_gameweek: {
        userTeamId,
        gameweek,
      },
    },
  });

  if (existing) return existing;

  const previous = await prisma.userGameweekState.findFirst({
    where: {
      userTeamId,
      gameweek: { lt: gameweek },
    },
    orderBy: { gameweek: "desc" },
  });

  const freeTransfers = previous
    ? Math.min(Math.max(previous.freeTransfers - previous.transfersMade, 0) + 1, 2)
    : 1;

  return prisma.userGameweekState.create({
    data: {
      userTeamId,
      gameweek,
      freeTransfers,
      transfersMade: 0,
      pointsHit: 0,
      activeChip: null,
    },
  });
}

/**
 * A team's points for a gameweek only count if the team existed before that
 * gameweek's deadline — GW1 is a one-time exception: it counts for every
 * team regardless of when it was created, since teams made after the GW1
 * deadline were still allowed to keep their GW1 points. From GW2 onward the
 * rule applies with no exceptions.
 */
function isTeamEligible(teamCreatedAt: Date, gameweek: number, deadlineTime: Date | null): boolean {
  if (gameweek === 1) return true;
  if (!deadlineTime) return true;
  return teamCreatedAt <= deadlineTime;
}

async function getGameweekDeadline(gameweek: number): Promise<Date | null> {
  const event = await prisma.fplEvent.findUnique({
    where: { id: gameweek },
    select: { deadlineTime: true },
  });
  return event?.deadlineTime ?? null;
}

async function buildStatsMap(gameweek: number): Promise<PlayerStatsMap> {
  const stats = await prisma.playerGameweekStat.findMany({
    where: { gameweek },
    select: {
      playerId: true,
      minutes: true,
      totalPoints: true,
    },
  });

  return new Map(stats.map((s) => [s.playerId, s]));
}

async function buildAllPicksMap(gameweek: number) {
  const picks = await prisma.userPick.findMany({
    where: { gameweek },
    orderBy: [{ userTeamId: "asc" }, { position: "asc" }],
    include: {
      player: {
        include: {
          team: true,
        },
      },
    },
  });

  const byTeam = new Map<string, PickWithRelations[]>();

  for (const pick of picks as PickWithRelations[]) {
    const arr = byTeam.get(pick.userTeamId) ?? [];
    arr.push(pick);
    byTeam.set(pick.userTeamId, arr);
  }

  return byTeam;
}

async function buildGwStatesMap(gameweek: number) {
  const states = await prisma.userGameweekState.findMany({
    where: { gameweek },
  });

  return new Map(states.map((s) => [s.userTeamId, s as GwStateLite]));
}

async function ensureGwStatesForAllTeams(gameweek: number) {
  const teams = await prisma.userTeam.findMany({
    select: { id: true },
  });

  for (const team of teams) {
    await ensureGameweekState(team.id, gameweek);
  }
}

export async function calculateTeamGameweekScore(userTeamId: string, gameweek?: number) {
  const gw = gameweek ?? (await getCurrentGameweekId());

  const team = await prisma.userTeam.findUnique({
    where: { id: userTeamId },
    select: { id: true, createdAt: true },
  });

  if (!team) throw new Error("NO_TEAM");

  const deadline = await getGameweekDeadline(gw);
  if (!isTeamEligible(team.createdAt, gw, deadline)) {
    throw new Error("GAMEWEEK_NOT_ELIGIBLE");
  }

  const gwState = await ensureGameweekState(userTeamId, gw);

  const picks = (await prisma.userPick.findMany({
    where: { userTeamId, gameweek: gw },
    orderBy: { position: "asc" },
    include: {
      player: {
        include: {
          team: true,
        },
      },
    },
  })) as PickWithRelations[];

  const statsMap = await buildStatsMap(gw);

  const result = calculateSingleTeamScore(picks, gwState as GwStateLite, statsMap);

  return prisma.userGameweekScore.upsert({
    where: {
      userTeamId_gameweek: {
        userTeamId,
        gameweek: gw,
      },
    },
    update: {
      pointsBeforeHits: result.pointsBeforeHits,
      finalPoints: result.finalPoints,
      transferHits: result.transferHits,
      pointsHit: result.pointsHit,
      captainPlayerId: result.captainPlayerId,
      viceCaptainPlayerId: result.viceCaptainPlayerId,
      activeChip: typeof result.chipPlayed === "string" ? result.chipPlayed : null,
      benchPoints: result.benchPoints,
      chipPlayed: result.chipPlayed as any,
      autoSubsApplied: result.autoSubsApplied,
      breakdown: result.breakdown,
      calculatedAt: new Date(),
    },
    create: {
      userTeamId,
      gameweek: gw,
      pointsBeforeHits: result.pointsBeforeHits,
      finalPoints: result.finalPoints,
      transferHits: result.transferHits,
      pointsHit: result.pointsHit,
      captainPlayerId: result.captainPlayerId,
      viceCaptainPlayerId: result.viceCaptainPlayerId,
      activeChip: typeof result.chipPlayed === "string" ? result.chipPlayed : null,
      benchPoints: result.benchPoints,
      chipPlayed: result.chipPlayed as any,
      autoSubsApplied: result.autoSubsApplied,
      breakdown: result.breakdown,
    },
  });
}

export async function calculateMyCurrentGameweekScore(userId: string) {
  const team = await prisma.userTeam.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (!team) throw new Error("NO_TEAM");

  return calculateTeamGameweekScore(team.id);
}

export async function getMyGameweekScore(userId: string, gameweek?: number) {
  const team = await prisma.userTeam.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (!team) throw new Error("NO_TEAM");

  const gw = gameweek ?? (await getCurrentGameweekId());

  const existing = await prisma.userGameweekScore.findUnique({
    where: {
      userTeamId_gameweek: {
        userTeamId: team.id,
        gameweek: gw,
      },
    },
  });

  if (existing) return existing;

  return calculateTeamGameweekScore(team.id, gw);
}

export async function getMyPointsHistory(userId: string) {
  const team = await prisma.userTeam.findUnique({
    where: { userId },
    select: {
      id: true,
      scores: {
        orderBy: { gameweek: "asc" },
      },
    },
  });

  if (!team) throw new Error("NO_TEAM");

  return {
    items: team.scores,
  };
}

export async function calculateAllTeamsForGameweek(gameweek?: number) {
  const gw = gameweek ?? (await getCurrentGameweekId());

  await ensureGwStatesForAllTeams(gw);

  const [teams, picksMap, gwStatesMap, statsMap, deadline] = await Promise.all([
    prisma.userTeam.findMany({
      select: { id: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    buildAllPicksMap(gw),
    buildGwStatesMap(gw),
    buildStatsMap(gw),
    getGameweekDeadline(gw),
  ]);

  const scoreRows: Array<{
    userTeamId: string;
    gameweek: number;
    pointsBeforeHits: number;
    finalPoints: number;
    transferHits: number;
    pointsHit: number;
    captainPlayerId: number | null;
    viceCaptainPlayerId: number | null;
    activeChip: string | null;
    benchPoints: number;
    chipPlayed: any;
    autoSubsApplied: any;
    breakdown: any;
  }> = [];

  for (const team of teams) {
    const picks = picksMap.get(team.id) ?? [];
    const gwState = gwStatesMap.get(team.id);

    if (!gwState || picks.length !== 15) continue;
    if (!isTeamEligible(team.createdAt, gw, deadline)) continue;

    const result = calculateSingleTeamScore(picks, gwState, statsMap);

    scoreRows.push({
      userTeamId: team.id,
      gameweek: gw,
      pointsBeforeHits: result.pointsBeforeHits,
      finalPoints: result.finalPoints,
      transferHits: result.transferHits,
      pointsHit: result.pointsHit,
      captainPlayerId: result.captainPlayerId,
      viceCaptainPlayerId: result.viceCaptainPlayerId,
      activeChip: typeof result.chipPlayed === "string" ? result.chipPlayed : null,
      benchPoints: result.benchPoints,
      chipPlayed: result.chipPlayed as any,
      autoSubsApplied: result.autoSubsApplied,
      breakdown: result.breakdown,
    });
  }

  await prisma.$transaction(async (tx) => {
    for (const row of scoreRows) {
      await tx.userGameweekScore.upsert({
        where: {
          userTeamId_gameweek: {
            userTeamId: row.userTeamId,
            gameweek: row.gameweek,
          },
        },
        update: {
          pointsBeforeHits: row.pointsBeforeHits,
          finalPoints: row.finalPoints,
          transferHits: row.transferHits,
          pointsHit: row.pointsHit,
          captainPlayerId: row.captainPlayerId,
          viceCaptainPlayerId: row.viceCaptainPlayerId,
          activeChip: row.activeChip,
          benchPoints: row.benchPoints,
          chipPlayed: row.chipPlayed,
          autoSubsApplied: row.autoSubsApplied,
          breakdown: row.breakdown,
          calculatedAt: new Date(),
        },
        create: row,
      });
    }
  });

  return {
    success: true,
    gameweek: gw,
    processedTeams: scoreRows.length,
  };
}