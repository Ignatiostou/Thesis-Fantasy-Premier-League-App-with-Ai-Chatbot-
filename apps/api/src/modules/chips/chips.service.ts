import { prisma } from '../../db/prisma.js';
import { ChipType } from '@fpl/types';
import {
  ensureSquadExistsForGameweek,
  getEditableGameweekId,
} from '../../utils/gameweek.js';

async function getUserTeam(userId: string) {
  const team = await prisma.userTeam.findUnique({
    where: { userId },
  });
  if (!team) throw new Error('NO_TEAM');
  return team;
}

async function ensureGameweekState(userTeamId: string, gameweek: number) {
  const existing = await prisma.userGameweekState.findUnique({
    where: { userTeamId_gameweek: { userTeamId, gameweek } },
  });
  if (existing) return existing;

  const previous = await prisma.userGameweekState.findFirst({
    where: { userTeamId, gameweek: { lt: gameweek } },
    orderBy: { gameweek: 'desc' },
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

async function chipAlreadyUsed(userTeamId: string, chip: ChipType) {
  if (chip === ChipType.WILDCARD) return false;

  const existing = await prisma.userChip.findFirst({
    where: { userTeamId, chip },
  });

  return !!existing;
}

async function wildcardAvailable(userTeamId: string, gameweek: number) {
  const firstHalf = gameweek <= 19;

  const used = await prisma.userChip.findFirst({
    where: {
      userTeamId,
      chip: ChipType.WILDCARD,
      ...(firstHalf ? { gameweek: { lte: 19 } } : { gameweek: { gte: 20 } }),
    },
  });

  return !used;
}

export async function getChipsStatus(userId: string) {
  const gameweek = await getEditableGameweekId();
  const team = await getUserTeam(userId);

  await ensureSquadExistsForGameweek(team.id, gameweek);
  const gwState = await ensureGameweekState(team.id, gameweek);

  const [benchBoostUsed, tripleCaptainUsed, freeHitUsed, wildcardAvailableNow] =
    await Promise.all([
      chipAlreadyUsed(team.id, ChipType.BENCH_BOOST),
      chipAlreadyUsed(team.id, ChipType.TRIPLE_CAPTAIN),
      chipAlreadyUsed(team.id, ChipType.FREE_HIT),
      wildcardAvailable(team.id, gameweek),
    ]);

  const [benchBoostRecord, tripleCaptainRecord, freeHitRecord, wildcardRecord] =
    await Promise.all([
      prisma.userChip.findFirst({
        where: { userTeamId: team.id, chip: ChipType.BENCH_BOOST },
        orderBy: { gameweek: 'desc' },
      }),
      prisma.userChip.findFirst({
        where: { userTeamId: team.id, chip: ChipType.TRIPLE_CAPTAIN },
        orderBy: { gameweek: 'desc' },
      }),
      prisma.userChip.findFirst({
        where: { userTeamId: team.id, chip: ChipType.FREE_HIT },
        orderBy: { gameweek: 'desc' },
      }),
      prisma.userChip.findFirst({
        where: { userTeamId: team.id, chip: ChipType.WILDCARD },
        orderBy: { gameweek: 'desc' },
      }),
    ]);

  return {
    activeChip: gwState.activeChip,
    gameweek,
    chips: [
      {
        chip: ChipType.WILDCARD,
        available: wildcardAvailableNow,
        usedInGw: wildcardRecord?.gameweek ?? null,
      },
      {
        chip: ChipType.BENCH_BOOST,
        available: !benchBoostUsed,
        usedInGw: benchBoostRecord?.gameweek ?? null,
      },
      {
        chip: ChipType.TRIPLE_CAPTAIN,
        available: !tripleCaptainUsed,
        usedInGw: tripleCaptainRecord?.gameweek ?? null,
      },
      {
        chip: ChipType.FREE_HIT,
        available: !freeHitUsed,
        usedInGw: freeHitRecord?.gameweek ?? null,
      },
    ],
  };
}

export async function playChip(userId: string, chip: ChipType) {
  const gameweek = await getEditableGameweekId();
  const team = await getUserTeam(userId);

  await ensureSquadExistsForGameweek(team.id, gameweek);
  const gwState = await ensureGameweekState(team.id, gameweek);

  if (gwState.activeChip) throw new Error('CHIP_ALREADY_ACTIVE');

  if (chip === ChipType.WILDCARD) {
    const available = await wildcardAvailable(team.id, gameweek);
    if (!available) throw new Error('WILDCARD_NOT_AVAILABLE');
  } else {
    const used = await chipAlreadyUsed(team.id, chip);
    if (used) throw new Error('CHIP_ALREADY_USED');
  }

  await prisma.$transaction(async (tx) => {
    await tx.userGameweekState.update({
      where: { userTeamId_gameweek: { userTeamId: team.id, gameweek } },
      data: { activeChip: chip },
    });

    await tx.userChip.create({
      data: {
        userTeamId: team.id,
        chip,
        gameweek,
      },
    });
  });

  return { success: true, chip, gameweek };
}

export async function clearChip(userId: string) {
  const gameweek = await getEditableGameweekId();
  const team = await getUserTeam(userId);

  await ensureSquadExistsForGameweek(team.id, gameweek);
  const gwState = await ensureGameweekState(team.id, gameweek);

  const activeChip = gwState.activeChip as ChipType | null;
  if (!activeChip) return { success: true, gameweek };

  await prisma.$transaction(async (tx) => {
    await tx.userGameweekState.update({
      where: {
        userTeamId_gameweek: {
          userTeamId: team.id,
          gameweek,
        },
      },
      data: {
        activeChip: null,
      },
    });

    await tx.userChip.deleteMany({
      where: {
        userTeamId: team.id,
        chip: activeChip,
        gameweek,
      },
    });
  });

  return { success: true, gameweek };
}