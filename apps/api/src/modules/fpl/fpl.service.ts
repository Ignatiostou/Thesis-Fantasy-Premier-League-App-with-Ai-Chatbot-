import { prisma } from '../../db/prisma.js';
import { getEditableGameweek } from '../../utils/gameweek.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PlayersQuery {
  teamId?: number;
  position?: number;
  q?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface FixturesQuery {
  event?: number;
  teamId?: number;
}

// ── Teams ─────────────────────────────────────────────────────────────────────

export async function getAllTeams() {
  return prisma.fplTeam.findMany({
    orderBy: { name: 'asc' },
  });
}

// ── Events ────────────────────────────────────────────────────────────────────

export async function getAllEvents() {
  return prisma.fplEvent.findMany({
    orderBy: { id: 'asc' },
  });
}

export async function getCurrentEvent() {
  const event = await prisma.fplEvent.findFirst({
    where: { isCurrent: true },
  });

  if (!event) {
    const err = new Error('No active gameweek found');
    (err as any).statusCode = 404;
    throw err;
  }

  return event;
}

export async function getNextEditableDeadline() {
  const editableGw = await getEditableGameweek();

  if (!editableGw) {
    const err = new Error('No editable gameweek found');
    (err as any).statusCode = 404;
    throw err;
  }

  return {
    gameweek: editableGw.id,
    name: editableGw.name,
    deadline: editableGw.effectiveDeadline,
    isCurrent: editableGw.isCurrent,
  };
}

// ── Players ───────────────────────────────────────────────────────────────────

function buildPlayerOrderBy(sortBy?: string) {
  switch (sortBy) {
    case 'price-asc':
      return [
        { nowCost: 'asc' as const },
        { totalPoints: 'desc' as const },
      ];

    case 'price-desc':
      return [
        { nowCost: 'desc' as const },
        { totalPoints: 'desc' as const },
      ];

    case 'minutes':
      return [
        { minutes: 'desc' as const },
        { totalPoints: 'desc' as const },
        { nowCost: 'asc' as const },
      ];

    case 'goals':
      return [
        { goalsScored: 'desc' as const },
        { totalPoints: 'desc' as const },
        { nowCost: 'asc' as const },
      ];

    case 'assists':
      return [
        { assists: 'desc' as const },
        { totalPoints: 'desc' as const },
        { nowCost: 'asc' as const },
      ];

    case 'clean-sheets':
      return [
        { cleanSheets: 'desc' as const },
        { totalPoints: 'desc' as const },
        { nowCost: 'asc' as const },
      ];

    case 'bonus':
      return [
        { bonus: 'desc' as const },
        { totalPoints: 'desc' as const },
        { nowCost: 'asc' as const },
      ];

    case 'selected':
      return [
        { selectedByPercent: 'desc' as const },
        { totalPoints: 'desc' as const },
        { nowCost: 'asc' as const },
      ];

    case 'form':
      return [
        { form: 'desc' as const },
        { totalPoints: 'desc' as const },
        { nowCost: 'asc' as const },
      ];

    case 'points':
    default:
      return [
        { totalPoints: 'desc' as const },
        { minutes: 'desc' as const },
        { nowCost: 'asc' as const },
      ];
  }
}

export async function getPlayers(
  query: PlayersQuery,
): Promise<PaginatedResult<any>> {
  const { teamId, position, q, sortBy } = query;

  const page = Math.max(1, Number(query.page ?? 1));
  const limit = Math.min(100, Math.max(1, Number(query.limit ?? 30)));
  const skip = (page - 1) * limit;

  const where: any = {
    ...(teamId ? { teamId } : {}),
    ...(position ? { position } : {}),
    ...(q?.trim()
      ? {
          OR: [
            { webName: { contains: q.trim(), mode: 'insensitive' as const } },
            { firstName: { contains: q.trim(), mode: 'insensitive' as const } },
            { secondName: { contains: q.trim(), mode: 'insensitive' as const } },
            {
              team: {
                name: { contains: q.trim(), mode: 'insensitive' as const },
              },
            },
            {
              team: {
                shortName: { contains: q.trim(), mode: 'insensitive' as const },
              },
            },
          ],
        }
      : {}),
  };

  const orderBy = buildPlayerOrderBy(sortBy);

  const [total, items] = await Promise.all([
    prisma.fplPlayer.count({ where }),
    prisma.fplPlayer.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      include: { team: true },
    }),
  ]);

  return {
    items,
    total,
    page,
    limit,
    hasMore: skip + items.length < total,
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

export async function getFixtures(query: FixturesQuery) {
  const { event, teamId } = query;

  return prisma.fplFixture.findMany({
    where: {
      ...(event ? { event } : {}),
      ...(teamId ? { OR: [{ teamHId: teamId }, { teamAId: teamId }] } : {}),
    },
    orderBy: { kickoffTime: 'asc' },
    include: { teamH: true, teamA: true },
  });
}