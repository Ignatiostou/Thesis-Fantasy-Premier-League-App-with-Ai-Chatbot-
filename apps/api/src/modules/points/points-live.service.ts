import { prisma } from "../../db/prisma.js";
import { calculateMyCurrentGameweekScore } from "./points.service.js";
import { syncPlayerGameweekStats } from "./points-sync.service.js";

async function getCurrentGameweek() {
  const current = await prisma.fplEvent.findFirst({
    where: { isCurrent: true },
    select: { id: true, finished: true },
  });

  return current ?? { id: 1, finished: false };
}

export async function getMyLivePointsSnapshot(userId: string) {
  const current = await getCurrentGameweek();
  const gameweek = current.id;

  // Best-effort sync so dashboard / points page can show fresh numbers.
  // If FPL live API is unavailable, continue gracefully.
  try {
    await syncPlayerGameweekStats(gameweek);
  } catch {
    // swallow on purpose
  }

  const score = await calculateMyCurrentGameweekScore(userId);

  const team = await prisma.userTeam.findUnique({
    where: { userId },
    select: {
      id: true,
      name: true,
      picks: {
        where: { gameweek },
        orderBy: { position: "asc" },
        include: {
          player: {
            include: {
              team: true,
              gwStats: {
                where: { gameweek },
                select: {
                  totalPoints: true,
                  minutes: true,
                },
                take: 1,
              },
            },
          },
        },
      },
    },
  });

  if (!team) {
    throw new Error("NO_TEAM");
  }

  return {
    gameweek,
    team: {
      id: team.id,
      name: team.name,
    },
    score,
    picks: team.picks.map((p) => ({
      id: p.id,
      playerId: p.playerId,
      webName: p.player.webName,
      teamShortName: p.player.team.shortName,
      position: p.player.position,
      isCaptain: p.isCaptain,
      isViceCaptain: p.isViceCaptain,
      isOnBench: p.isOnBench,
      benchOrder: p.benchOrder,
      eventPoints: p.player.gwStats[0]?.totalPoints ?? 0,
      totalPoints: p.player.totalPoints ?? 0,
      minutes: p.player.gwStats[0]?.minutes ?? 0,
    })),
    polledAt: new Date().toISOString(),
    nextPollInMs: 60000,
    finished: current.finished ?? false,
  };
}