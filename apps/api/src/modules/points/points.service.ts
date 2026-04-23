import { prisma } from "../../db/prisma.js";
import { ChipType } from "@fpl/types";

type PlayerStatLite = {
  playerId: number;
  minutes: number;
  totalPoints: number;
};

type PlayerStatsMap = Map<number, PlayerStatLite>;

type PickWithRelations = {
  id: string;
  userTeamId: string;
  playerId: number;
  teamId: number;
  gameweek: number;
  position: number;
  isCaptain: boolean;
  isViceCaptain: boolean;
  isOnBench: boolean;
  benchOrder: number | null;
  buyPrice: number;
  player: {
    id: number;
    webName: string;
    position: number;
    teamId: number;
    eventPoints: number | null;
    totalPoints: number | null;
    team: {
      id: number;
      name: string;
      shortName: string;
    };
  };
};

type GwStateLite = {
  userTeamId: string;
  gameweek: number;
  freeTransfers: number;
  transfersMade: number;
  pointsHit: number;
  activeChip: string | null;
};

function isBenchBoost(chip: string | null | undefined) {
  return chip === ChipType.BENCH_BOOST;
}

function isTripleCaptain(chip: string | null | undefined) {
  return chip === ChipType.TRIPLE_CAPTAIN;
}

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

function getPlayerMinutes(playerId: number, statsMap: PlayerStatsMap) {
  return statsMap.get(playerId)?.minutes ?? 0;
}

function getPlayerBasePoints(playerId: number, statsMap: PlayerStatsMap) {
  return statsMap.get(playerId)?.totalPoints ?? 0;
}

function countFormationByPosition(players: PickWithRelations[]) {
  const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };

  for (const p of players) {
    counts[p.player.position] = (counts[p.player.position] ?? 0) + 1;
  }

  return counts;
}

function isValidStartingFormation(players: PickWithRelations[]) {
  if (players.length !== 11) return false;

  const c = countFormationByPosition(players);

  return (
    c[1] === 1 &&
    c[2] >= 3 &&
    c[3] >= 2 &&
    c[4] >= 1
  );
}

function applyAutoSubs(
  starters: PickWithRelations[],
  bench: PickWithRelations[],
  statsMap: PlayerStatsMap,
) {
  const updatedStarters = [...starters];
  const sortedBench = [...bench].sort(
    (a, b) => (a.benchOrder ?? 99) - (b.benchOrder ?? 99),
  );

  const usedBenchIds = new Set<number>();
  const autoSubs: Array<{
    outPlayerId: number;
    outWebName: string;
    inPlayerId: number;
    inWebName: string;
  }> = [];

  const starterGkIndex = updatedStarters.findIndex((p) => p.player.position === 1);

  if (starterGkIndex !== -1) {
    const starterGk = updatedStarters[starterGkIndex];

    if (getPlayerMinutes(starterGk.playerId, statsMap) === 0) {
      const benchGk = sortedBench.find(
        (b) =>
          b.player.position === 1 &&
          getPlayerMinutes(b.playerId, statsMap) > 0,
      );

      if (benchGk) {
        updatedStarters[starterGkIndex] = benchGk;
        usedBenchIds.add(benchGk.playerId);

        autoSubs.push({
          outPlayerId: starterGk.playerId,
          outWebName: starterGk.player.webName,
          inPlayerId: benchGk.playerId,
          inWebName: benchGk.player.webName,
        });
      }
    }
  }

  for (let i = 0; i < updatedStarters.length; i++) {
    const starter = updatedStarters[i];

    if (starter.player.position === 1) continue;
    if (getPlayerMinutes(starter.playerId, statsMap) > 0) continue;

    for (const benchPlayer of sortedBench) {
      if (usedBenchIds.has(benchPlayer.playerId)) continue;
      if (benchPlayer.player.position === 1) continue;
      if (getPlayerMinutes(benchPlayer.playerId, statsMap) === 0) continue;

      const tentative = [...updatedStarters];
      tentative[i] = benchPlayer;

      if (!isValidStartingFormation(tentative)) continue;

      updatedStarters[i] = benchPlayer;
      usedBenchIds.add(benchPlayer.playerId);

      autoSubs.push({
        outPlayerId: starter.playerId,
        outWebName: starter.player.webName,
        inPlayerId: benchPlayer.playerId,
        inWebName: benchPlayer.player.webName,
      });

      break;
    }
  }

  return {
    startersAfterAutoSubs: updatedStarters,
    autoSubs,
  };
}

function resolveCaptain(
  originalStarters: PickWithRelations[],
  countedPlayers: PickWithRelations[],
  statsMap: PlayerStatsMap,
) {
  const originalCaptain = originalStarters.find((p) => p.isCaptain) ?? null;
  const originalVice = originalStarters.find((p) => p.isViceCaptain) ?? null;

  const countedIds = new Set(countedPlayers.map((p) => p.playerId));

  const captainPlayed =
    originalCaptain &&
    countedIds.has(originalCaptain.playerId) &&
    getPlayerMinutes(originalCaptain.playerId, statsMap) > 0;

  if (captainPlayed) {
    return {
      effectiveCaptainId: originalCaptain.playerId,
      effectiveViceCaptainId: originalVice?.playerId ?? null,
    };
  }

  const vicePlayed =
    originalVice &&
    countedIds.has(originalVice.playerId) &&
    getPlayerMinutes(originalVice.playerId, statsMap) > 0;

  if (vicePlayed) {
    return {
      effectiveCaptainId: originalVice.playerId,
      effectiveViceCaptainId: null,
    };
  }

  return {
    effectiveCaptainId: null,
    effectiveViceCaptainId: null,
  };
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

function calculateSingleTeamScore(
  picks: PickWithRelations[],
  gwState: GwStateLite,
  statsMap: PlayerStatsMap,
) {
  if (picks.length !== 15) {
    throw new Error("INVALID_PICKS_FOR_GAMEWEEK");
  }

  const starters = picks.filter((p) => !p.isOnBench);
  const bench = picks
    .filter((p) => p.isOnBench)
    .sort((a, b) => (a.benchOrder ?? 99) - (b.benchOrder ?? 99));

  const activeChip = gwState.activeChip;
  const benchBoost = isBenchBoost(activeChip);
  const tripleCaptain = isTripleCaptain(activeChip);

  let countedPlayers: PickWithRelations[] = [];
  let autoSubs: Array<{
    outPlayerId: number;
    outWebName: string;
    inPlayerId: number;
    inWebName: string;
  }> = [];

  if (benchBoost) {
    countedPlayers = [...starters, ...bench];
  } else {
    const auto = applyAutoSubs(starters, bench, statsMap);
    countedPlayers = auto.startersAfterAutoSubs;
    autoSubs = auto.autoSubs;
  }

  const { effectiveCaptainId, effectiveViceCaptainId } = resolveCaptain(
    starters,
    countedPlayers,
    statsMap,
  );

  let pointsBeforeHits = 0;
  let benchPoints = 0;

  const countedIds = new Set(countedPlayers.map((p) => p.playerId));

  const breakdown = picks.map((pick) => {
    const basePoints = getPlayerBasePoints(pick.playerId, statsMap);
    const minutes = getPlayerMinutes(pick.playerId, statsMap);

    const counted = countedIds.has(pick.playerId);
    let multiplier = 0;
    let finalPoints = 0;

    if (counted) {
      multiplier = 1;

      if (effectiveCaptainId && pick.playerId === effectiveCaptainId) {
        multiplier = tripleCaptain ? 3 : 2;
      }

      finalPoints = basePoints * multiplier;
      pointsBeforeHits += finalPoints;
    } else {
      if (pick.isOnBench) {
        benchPoints += basePoints;
      }
    }

    return {
      playerId: pick.playerId,
      webName: pick.player.webName,
      teamShortName: pick.player.team.shortName,
      position: pick.player.position,
      minutes,
      basePoints,
      multiplier,
      finalPoints,
      counted,
      wasAutoSubbedIn: autoSubs.some((s) => s.inPlayerId === pick.playerId),
      wasAutoSubbedOut: autoSubs.some((s) => s.outPlayerId === pick.playerId),
      isCaptain: pick.playerId === effectiveCaptainId,
      isViceCaptain: pick.playerId === effectiveViceCaptainId,
      isOnBench: pick.isOnBench,
    };
  });

  const pointsHit = gwState.pointsHit ?? 0;
  const finalPoints = pointsBeforeHits - pointsHit;

  return {
    pointsBeforeHits,
    finalPoints,
    transferHits: Math.floor(pointsHit / 4),
    pointsHit,
    benchPoints,
    captainPlayerId: effectiveCaptainId,
    viceCaptainPlayerId: effectiveViceCaptainId,
    chipPlayed: activeChip,
    autoSubsApplied: autoSubs,
    breakdown,
  };
}

export async function calculateTeamGameweekScore(userTeamId: string, gameweek?: number) {
  const gw = gameweek ?? (await getCurrentGameweekId());

  const team = await prisma.userTeam.findUnique({
    where: { id: userTeamId },
    select: { id: true },
  });

  if (!team) throw new Error("NO_TEAM");

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

  const [teams, picksMap, gwStatesMap, statsMap] = await Promise.all([
    prisma.userTeam.findMany({
      select: { id: true },
      orderBy: { createdAt: "asc" },
    }),
    buildAllPicksMap(gw),
    buildGwStatesMap(gw),
    buildStatsMap(gw),
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