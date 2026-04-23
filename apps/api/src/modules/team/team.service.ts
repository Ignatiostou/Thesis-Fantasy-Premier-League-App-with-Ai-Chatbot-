import { prisma } from "../../db/prisma.js";
import {
  ensureUserTeamPicksForGameweek,
  getEditableGameweekId,
} from "../../utils/gameweek.js";

const BUDGET_START = 1000; // £100.0m in tenths
const LIMITS = { GK: 2, DEF: 5, MID: 5, FWD: 3 } as const;

function posName(position: number) {
  return position === 1 ? "GK" : position === 2 ? "DEF" : position === 3 ? "MID" : "FWD";
}

function isValidStartingFormation(players: Array<{ player: { position: number } }>) {
  if (players.length !== 11) return false;

  const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };

  for (const p of players) {
    counts[p.player.position] = (counts[p.player.position] ?? 0) + 1;
  }

  return (
    counts[1] === 1 &&
    counts[2] >= 3 &&
    counts[3] >= 2 &&
    counts[4] >= 1
  );
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

export async function getMyTeam(userId: string) {
  const gw = await getEditableGameweekId();

  const teamRef = await prisma.userTeam.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (!teamRef) return { team: null };

  await ensureUserTeamPicksForGameweek(teamRef.id, gw);
  const gwState = await ensureGameweekState(teamRef.id, gw);

  const team = await prisma.userTeam.findUnique({
    where: { userId },
    include: {
      picks: {
        where: { gameweek: gw },
        orderBy: { position: "asc" },
        include: {
          player: {
            include: { team: true },
          },
        },
      },
    },
  });

  if (!team) return { team: null };

  const totalPointsAgg = await prisma.userGameweekScore.aggregate({
    where: { userTeamId: team.id },
    _sum: { finalPoints: true },
  });

  const mappedPicks = team.picks.map((pick) => {
    return {
      id: pick.id,
      playerId: pick.playerId,
      position: pick.player.position as 1 | 2 | 3 | 4,
      webName: pick.player.webName,
      nowCost: pick.player.nowCost,
      status: pick.player.status,
      totalPoints: pick.player.totalPoints ?? 0,

      // Δεν δείχνουμε "ζωντανό" eventPoints εδώ γιατί το /team/me είναι editable squad endpoint
      // και αλλιώς μπερδεύει όταν η editable GW είναι η επόμενη.
      eventPoints: 0,

      chanceOfPlayingNextRound: pick.player.chanceOfPlayingNextRound ?? null,

      isCaptain: pick.isCaptain,
      isViceCaptain: pick.isViceCaptain,
      isOnBench: pick.isOnBench,
      benchOrder: pick.benchOrder,

      team: {
        id: pick.player.team.id,
        name: pick.player.team.name,
        shortName: pick.player.team.shortName,
      },
    };
  });

  return {
    team: {
      id: team.id,
      name: team.name,
      totalPoints: totalPointsAgg._sum.finalPoints ?? 0,
      overallRank: null,
      gameweek: gw,
      usedWildcard: false,
      usedBenchBoost: false,
      activeChip: gwState.activeChip ?? null,
      picks: mappedPicks,
    },
  };
}

export async function initializeSquad(userId: string, playerIds: number[], name?: string) {
  const existing = await prisma.userTeam.findUnique({ where: { userId } });
  if (existing) throw new Error("TEAM_ALREADY_EXISTS");

  // ΠΟΛΥ ΣΗΜΑΝΤΙΚΟ:
  // Αν έχει περάσει το deadline της current GW, το squad δημιουργείται για την επόμενη.
  const gw = await getEditableGameweekId();

  const uniqueIds = Array.from(new Set(playerIds));
  if (uniqueIds.length !== 15) throw new Error("INVALID_DUPLICATE_PLAYERS");

  const players = await prisma.fplPlayer.findMany({
    where: { id: { in: uniqueIds } },
    include: { team: true },
  });

  if (players.length !== 15) throw new Error("INVALID_PLAYERS_NOT_FOUND");

  const counts = { GK: 0, DEF: 0, MID: 0, FWD: 0 } as Record<string, number>;
  let totalCost = 0;

  const clubCount = new Map<number, number>();
  for (const p of players) {
    const pn = posName(p.position);
    counts[pn] = (counts[pn] ?? 0) + 1;
    totalCost += p.nowCost;

    clubCount.set(p.teamId, (clubCount.get(p.teamId) ?? 0) + 1);
    if ((clubCount.get(p.teamId) ?? 0) > 3) throw new Error("INVALID_MAX_3_PER_CLUB");
  }

  if (counts.GK !== LIMITS.GK) throw new Error("INVALID_GK_COUNT");
  if (counts.DEF !== LIMITS.DEF) throw new Error("INVALID_DEF_COUNT");
  if (counts.MID !== LIMITS.MID) throw new Error("INVALID_MID_COUNT");
  if (counts.FWD !== LIMITS.FWD) throw new Error("INVALID_FWD_COUNT");
  if (totalCost > BUDGET_START) throw new Error("INVALID_BUDGET");

  const result = await prisma.$transaction(async (tx) => {
    const team = await tx.userTeam.create({
      data: {
        userId,
        name: name ?? "My FPL Team",
        budget: BUDGET_START - totalCost,
        season: "2025-26",
      },
    });

    const byPos = {
      1: players.filter((p) => p.position === 1).sort((a, b) => (b.totalPoints ?? 0) - (a.totalPoints ?? 0)),
      2: players.filter((p) => p.position === 2).sort((a, b) => (b.totalPoints ?? 0) - (a.totalPoints ?? 0)),
      3: players.filter((p) => p.position === 3).sort((a, b) => (b.totalPoints ?? 0) - (a.totalPoints ?? 0)),
      4: players.filter((p) => p.position === 4).sort((a, b) => (b.totalPoints ?? 0) - (a.totalPoints ?? 0)),
    };

    const starters = [
      byPos[1][0],
      ...byPos[2].slice(0, 3),
      ...byPos[3].slice(0, 4),
      ...byPos[4].slice(0, 3),
    ];

    const starterIds = new Set(starters.map((p) => p.id));

    const benchGk = byPos[1][1];
    const benchOutfield = players
      .filter((p) => !starterIds.has(p.id) && p.id !== benchGk?.id)
      .sort((a, b) => (b.totalPoints ?? 0) - (a.totalPoints ?? 0));

    const bench = [benchGk, ...benchOutfield].filter(Boolean) as typeof players;

    const ordered = [
      ...starters.map((p, idx) => ({
        ...p,
        slotPosition: idx + 1,
        isOnBench: false,
        benchOrder: null as number | null,
      })),
      ...bench.map((p, idx) => ({
        ...p,
        slotPosition: 12 + idx,
        isOnBench: true,
        benchOrder: idx + 1,
      })),
    ];

    await tx.userPick.createMany({
      data: ordered.map((p, idx) => ({
        userTeamId: team.id,
        playerId: p.id,
        teamId: p.teamId,
        gameweek: gw,
        position: p.slotPosition,
        isCaptain: idx === 0,
        isViceCaptain: idx === 1,
        isOnBench: p.isOnBench,
        benchOrder: p.benchOrder,
        buyPrice: p.nowCost,
      })),
    });

    await tx.userGameweekState.create({
      data: {
        userTeamId: team.id,
        gameweek: gw,
        freeTransfers: 1,
        transfersMade: 0,
        pointsHit: 0,
        activeChip: null,
      },
    });

    return {
      teamId: team.id,
      gameweek: gw,
      budgetLeft: team.budget,
    };
  });

  return result;
}

export async function updateLineup(
  userId: string,
  captain: number,
  viceCaptain: number,
  benchOrder: number[],
) {
  if (!Array.isArray(benchOrder) || benchOrder.length !== 4) {
    throw new Error("WRONG_BENCH_ORDER");
  }

  if (new Set(benchOrder).size !== 4) {
    throw new Error("WRONG_BENCH_ORDER");
  }

  if (!captain || !viceCaptain || captain === viceCaptain) {
    throw new Error("INVALID_CAPTAIN");
  }

  const gw = await getEditableGameweekId();

  const team = await prisma.userTeam.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (!team) throw new Error("NO_TEAM");

  await ensureUserTeamPicksForGameweek(team.id, gw);
  await ensureGameweekState(team.id, gw);

  const picks = await prisma.userPick.findMany({
    where: { userTeamId: team.id, gameweek: gw },
    orderBy: { position: "asc" },
    include: {
      player: true,
    },
  });

  if (picks.length !== 15) {
    throw new Error("WRONG_SQUAD_SIZE");
  }

  const byPlayerId = new Map(picks.map((p) => [p.playerId, p]));

  for (const playerId of benchOrder) {
    if (!byPlayerId.has(playerId)) throw new Error("WRONG_BENCH_ORDER");
  }

  if (!byPlayerId.has(captain) || !byPlayerId.has(viceCaptain)) {
    throw new Error("INVALID_CAPTAIN");
  }

  const benchSet = new Set(benchOrder);
  if (benchSet.has(captain) || benchSet.has(viceCaptain)) {
    throw new Error("INVALID_CAPTAIN");
  }

  const starters = picks.filter((p) => !benchSet.has(p.playerId));
  if (!isValidStartingFormation(starters.map((p) => ({ player: { position: p.player.position } })))) {
    throw new Error("INVALID_FORMATION");
  }

  const orderedStarters = [...starters].sort((a, b) => {
    if (a.player.position !== b.player.position) return a.player.position - b.player.position;
    return a.position - b.position;
  });

  const orderedBench = benchOrder.map((playerId) => byPlayerId.get(playerId)!);

  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < orderedStarters.length; i++) {
      const p = orderedStarters[i];
      await tx.userPick.update({
        where: { id: p.id },
        data: {
          position: i + 1,
          isOnBench: false,
          benchOrder: null,
          isCaptain: p.playerId === captain,
          isViceCaptain: p.playerId === viceCaptain,
        },
      });
    }

    for (let i = 0; i < orderedBench.length; i++) {
      const p = orderedBench[i];
      await tx.userPick.update({
        where: { id: p.id },
        data: {
          position: 12 + i,
          isOnBench: true,
          benchOrder: i + 1,
          isCaptain: false,
          isViceCaptain: false,
        },
      });
    }
  });

  return { success: true, gameweek: gw };
}