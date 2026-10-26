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
    // Excludes ids the FPL API no longer returns — most commonly a player
    // reissued a new element id (transfer / season rollover), leaving the
    // old id's row behind (never deleted — picks/transfers/stats reference
    // it by FK) but no longer a real, pickable player. Without this filter
    // the same person can appear twice under two different ids/clubs/prices.
    isActiveInFpl: true,
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

  // With a search term, relevance beats the global sort. Ordering purely by
  // points meant typing "T" listed the highest scorers that merely contained a
  // "t" somewhere — including via their club name — so the player actually
  // being typed stayed buried until almost the whole name was entered.
  // Matches are few enough to rank in memory and paginate afterwards.
  if (q?.trim()) {
    const term = q.trim().toLowerCase();

    const matches = await prisma.fplPlayer.findMany({
      where,
      orderBy,
      include: { team: true },
      take: 500,
    });

    const rank = (p: any): number => {
      const web = (p.webName ?? '').toLowerCase();
      const first = (p.firstName ?? '').toLowerCase();
      const second = (p.secondName ?? '').toLowerCase();
      if (web.startsWith(term)) return 0;
      if (second.startsWith(term) || first.startsWith(term)) return 1;
      if (web.includes(term)) return 2;
      if (second.includes(term) || first.includes(term)) return 3;
      return 4;                                   // matched only on club
    };

    const ranked = matches
      .map((p, i) => ({ p, r: rank(p), i }))
      // Stable within a rank: keeps the requested sort (points by default).
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map((x) => x.p);

    return {
      items: ranked.slice(skip, skip + limit),
      total: ranked.length,
      page,
      limit,
      hasMore: skip + limit < ranked.length,
    };
  }

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

  const fixtures = await prisma.fplFixture.findMany({
    where: {
      ...(event ? { event } : {}),
      ...(teamId ? { OR: [{ teamHId: teamId }, { teamAId: teamId }] } : {}),
    },
    orderBy: { kickoffTime: 'asc' },
    include: { teamH: true, teamA: true },
  });

  // `finished` only flips once FPL confirms bonus points, which can lag hours
  // behind the final whistle — a match can sit at `finished: false` for a day+
  // with a locked-in score. `finished_provisional` (already in the raw payload
  // we store) flips at full time; that's what should drive "show the score".
  return fixtures.map((f) => ({
    ...f,
    finishedProvisional: (f.raw as any)?.finished_provisional ?? f.finished,
  }));
}