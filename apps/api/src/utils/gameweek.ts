import { prisma } from '../db/prisma.js';

/**
 * Deadline rule:
 * - preferred: 10 minutes before the first fixture kickoff of the GW
 * - fallback: event.deadlineTime from FPL bootstrap
 */
export async function getEffectiveDeadline(gameweek: number): Promise<Date | null> {
  const [event, firstFixture] = await Promise.all([
    prisma.fplEvent.findUnique({
      where: { id: gameweek },
      select: { deadlineTime: true },
    }),
    prisma.fplFixture.findFirst({
      where: {
        event: gameweek,
        kickoffTime: { not: null },
      },
      orderBy: { kickoffTime: 'asc' },
      select: { kickoffTime: true },
    }),
  ]);

  if (firstFixture?.kickoffTime) {
    return new Date(firstFixture.kickoffTime.getTime() - 10 * 60 * 1000);
  }

  return event?.deadlineTime ?? null;
}

/**
 * Live/current GW = the one currently marked isCurrent in DB
 * Used for live points / current fixtures / scoring
 */
export async function getLiveGameweekId(): Promise<number> {
  const current = await prisma.fplEvent.findFirst({
    where: { isCurrent: true },
    select: { id: true },
  });

  return current?.id ?? 1;
}

/**
 * Editable GW = the first unfinished GW whose effective deadline has NOT passed yet.
 * This is the GW the user is allowed to edit.
 */
export async function getEditableGameweek() {
  const now = new Date();

  const events = await prisma.fplEvent.findMany({
    where: { finished: false },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      name: true,
      deadlineTime: true,
      finished: true,
      isCurrent: true,
    },
  });

  for (const ev of events) {
    const effectiveDeadline = await getEffectiveDeadline(ev.id);

    if (!effectiveDeadline) {
      return {
        ...ev,
        effectiveDeadline: null,
      };
    }

    if (effectiveDeadline > now) {
      return {
        ...ev,
        effectiveDeadline,
      };
    }
  }

  const fallback =
    events[events.length - 1] ??
    (await prisma.fplEvent.findFirst({
      where: { isCurrent: true },
      select: {
        id: true,
        name: true,
        deadlineTime: true,
        finished: true,
        isCurrent: true,
      },
    }));

  if (!fallback) return null;

  return {
    ...fallback,
    effectiveDeadline: await getEffectiveDeadline(fallback.id),
  };
}

export async function getEditableGameweekId(): Promise<number> {
  const gw = await getEditableGameweek();
  return gw?.id ?? 1;
}

/**
 * Which gameweek's squad should carry forward.
 *
 * Normally the one just gone. The exception is Free Hit: it buys a squad for a
 * single gameweek only, so the next gameweek must inherit from the gameweek
 * BEFORE it — that reversion is the whole point of the chip. Doing it here
 * means the revert happens exactly when the next squad is first materialised
 * (at the deadline, or the first time the team is opened afterwards) without a
 * separate snapshot table or scheduled job.
 *
 * If the Free Hit was played in the very first gameweek there is nothing to
 * revert to, and the free-hit squad simply stands.
 */
async function resolveSquadSourceGameweek(
  userTeamId: string,
  candidateGameweek: number,
): Promise<number> {
  const state = await prisma.userGameweekState.findUnique({
    where: {
      userTeamId_gameweek: { userTeamId, gameweek: candidateGameweek },
    },
    select: { activeChip: true, budgetBeforeChip: true },
  });

  if (state?.activeChip !== 'FREE_HIT') return candidateGameweek;

  const beforeFreeHit = await prisma.userPick.findFirst({
    where: {
      userTeamId,
      gameweek: { lt: candidateGameweek },
    },
    orderBy: { gameweek: 'desc' },
    select: { gameweek: true },
  });

  if (!beforeFreeHit) return candidateGameweek;

  // The squad going back without the money going back would leave the team with
  // whatever bank the one-week squad happened to leave behind.
  if (state.budgetBeforeChip !== null && state.budgetBeforeChip !== undefined) {
    await prisma.userTeam.update({
      where: { id: userTeamId },
      data: { budget: state.budgetBeforeChip },
    });
  }

  return beforeFreeHit.gameweek;
}

/**
 * Ensures a team has 15 picks for the target gameweek.
 * If not, copies the latest previous gameweek picks into the target GW.
 * A Free Hit gameweek is skipped over — see resolveSquadSourceGameweek.
 */
export async function ensureSquadExistsForGameweek(
  userTeamId: string,
  gameweek: number,
): Promise<void> {
  const existingCount = await prisma.userPick.count({
    where: { userTeamId, gameweek },
  });

  if (existingCount === 15) return;

  const latestPreviousGw = await prisma.userPick.findFirst({
    where: {
      userTeamId,
      gameweek: { lt: gameweek },
    },
    orderBy: { gameweek: 'desc' },
    select: { gameweek: true },
  });

  if (!latestPreviousGw) return;

  const sourceGameweek = await resolveSquadSourceGameweek(
    userTeamId,
    latestPreviousGw.gameweek,
  );

  const previousPicks = await prisma.userPick.findMany({
    where: {
      userTeamId,
      gameweek: sourceGameweek,
    },
    orderBy: { position: 'asc' },
  });

  if (previousPicks.length !== 15) return;

  await prisma.userPick.createMany({
    data: previousPicks.map((p) => ({
      userTeamId: p.userTeamId,
      playerId: p.playerId,
      teamId: p.teamId,
      gameweek,
      position: p.position,
      isCaptain: p.isCaptain,
      isViceCaptain: p.isViceCaptain,
      isOnBench: p.isOnBench,
      benchOrder: p.benchOrder,
      buyPrice: p.buyPrice,
    })),
  });
}

export async function getLiveGameweek(): Promise<{
  id: number;
  name: string;
  deadlineTime: Date | null;
  finished: boolean | null;
  isCurrent: boolean | null;
} | null> {
  return prisma.fplEvent.findFirst({
    where: { isCurrent: true },
    select: {
      id: true,
      name: true,
      deadlineTime: true,
      finished: true,
      isCurrent: true,
    },
  });
}

export async function ensureUserTeamPicksForGameweek(
  userTeamId: string,
  gameweek: number,
): Promise<void> {
  return ensureSquadExistsForGameweek(userTeamId, gameweek);
}