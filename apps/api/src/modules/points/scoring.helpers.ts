import { ChipType } from "@fpl/types";

// ── Shared types ────────────────────────────────────────────────────────────
//
// These mirror the Prisma-shaped data points.service.ts builds before handing
// off to the pure scoring functions below — kept here so both the service and
// its tests import one shared definition instead of two independently
// maintained copies.

export type PlayerStatLite = {
  playerId: number;
  minutes: number;
  totalPoints: number;
};

export type PlayerStatsMap = Map<number, PlayerStatLite>;

export type PickWithRelations = {
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

export type GwStateLite = {
  userTeamId: string;
  gameweek: number;
  freeTransfers: number;
  transfersMade: number;
  pointsHit: number;
  activeChip: string | null;
};

// ── Pure scoring logic ───────────────────────────────────────────────────────
//
// No Prisma/DB access anywhere below this line — everything here is a plain
// function of its arguments, which is what makes it directly unit-testable
// without mocking the database.

export function isBenchBoost(chip: string | null | undefined) {
  return chip === ChipType.BENCH_BOOST;
}

export function isTripleCaptain(chip: string | null | undefined) {
  return chip === ChipType.TRIPLE_CAPTAIN;
}

export function getPlayerMinutes(playerId: number, statsMap: PlayerStatsMap) {
  return statsMap.get(playerId)?.minutes ?? 0;
}

export function getPlayerBasePoints(playerId: number, statsMap: PlayerStatsMap) {
  return statsMap.get(playerId)?.totalPoints ?? 0;
}

export function countFormationByPosition(players: PickWithRelations[]) {
  const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };

  for (const p of players) {
    counts[p.player.position] = (counts[p.player.position] ?? 0) + 1;
  }

  return counts;
}

export function isValidStartingFormation(players: PickWithRelations[]) {
  if (players.length !== 11) return false;

  const c = countFormationByPosition(players);

  return (
    c[1] === 1 &&
    c[2] >= 3 &&
    c[3] >= 2 &&
    c[4] >= 1
  );
}

export function applyAutoSubs(
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

export function resolveCaptain(
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

export function calculateSingleTeamScore(
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
