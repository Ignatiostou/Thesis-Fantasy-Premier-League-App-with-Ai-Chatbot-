import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/prisma.js', () => ({
  prisma: {
    fplTeam:    { findMany: vi.fn() },
    fplEvent:   { findMany: vi.fn(), findFirst: vi.fn() },
    fplPlayer:  { count: vi.fn(), findMany: vi.fn() },
    fplFixture: { findMany: vi.fn() },
  },
}));

vi.mock('../../utils/gameweek.js', () => ({
  getEditableGameweek: vi.fn(),
  getEditableGameweekId: vi.fn().mockResolvedValue(34),
}));

import {
  getAllTeams,
  getAllEvents,
  getCurrentEvent,
  getPlayers,
  getFixtures,
} from './fpl.service.js';
import { prisma } from '../../db/prisma.js';

beforeEach(() => vi.clearAllMocks());

// ── getAllTeams ────────────────────────────────────────────────────────────────

describe('getAllTeams', () => {
  it('returns teams ordered by name', async () => {
    const teams = [
      { id: 1, name: 'Arsenal', shortName: 'ARS' },
      { id: 2, name: 'Chelsea', shortName: 'CHE' },
    ];
    vi.mocked(prisma.fplTeam.findMany).mockResolvedValue(teams as any);

    const result = await getAllTeams();

    expect(result).toEqual(teams);
    expect(prisma.fplTeam.findMany).toHaveBeenCalledWith({ orderBy: { name: 'asc' } });
  });

  it('returns empty array when no teams exist', async () => {
    vi.mocked(prisma.fplTeam.findMany).mockResolvedValue([]);
    expect(await getAllTeams()).toEqual([]);
  });
});

// ── getAllEvents ───────────────────────────────────────────────────────────────

describe('getAllEvents', () => {
  it('returns all events ordered by id', async () => {
    const events = [
      { id: 1, name: 'Gameweek 1', finished: true, isCurrent: false },
      { id: 2, name: 'Gameweek 2', finished: false, isCurrent: true },
    ];
    vi.mocked(prisma.fplEvent.findMany).mockResolvedValue(events as any);

    const result = await getAllEvents();

    expect(result).toEqual(events);
    expect(prisma.fplEvent.findMany).toHaveBeenCalledWith({ orderBy: { id: 'asc' } });
  });
});

// ── getCurrentEvent ───────────────────────────────────────────────────────────

describe('getCurrentEvent', () => {
  it('returns the current event', async () => {
    const event = { id: 34, name: 'Gameweek 34', isCurrent: true, finished: false };
    vi.mocked(prisma.fplEvent.findFirst).mockResolvedValue(event as any);

    const result = await getCurrentEvent();

    expect(result.id).toBe(34);
    expect(prisma.fplEvent.findFirst).toHaveBeenCalledWith({ where: { isCurrent: true } });
  });

  it('throws a 404 error when no active gameweek exists', async () => {
    vi.mocked(prisma.fplEvent.findFirst).mockResolvedValue(null);

    const err = await getCurrentEvent().catch((e) => e);
    expect(err.message).toBe('No active gameweek found');
    expect(err.statusCode).toBe(404);
  });
});

// ── getPlayers ────────────────────────────────────────────────────────────────

describe('getPlayers', () => {
  const fakePlayer = (id: number) => ({
    id,
    webName: `Player${id}`,
    position: 3,
    teamId: 1,
    nowCost: 80,
    totalPoints: 100,
    team: { id: 1, name: 'Arsenal', shortName: 'ARS' },
  });

  beforeEach(() => {
    vi.mocked(prisma.fplPlayer.count).mockResolvedValue(0);
    vi.mocked(prisma.fplPlayer.findMany).mockResolvedValue([]);
  });

  it('returns paginated result with correct shape', async () => {
    vi.mocked(prisma.fplPlayer.count).mockResolvedValue(50);
    vi.mocked(prisma.fplPlayer.findMany).mockResolvedValue(
      [fakePlayer(1), fakePlayer(2)] as any,
    );

    const result = await getPlayers({ page: 1, limit: 30 });

    expect(result.total).toBe(50);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(30);
    expect(result.items).toHaveLength(2);
    expect(result.hasMore).toBe(true);
  });

  it('hasMore is false when all items fit on one page', async () => {
    vi.mocked(prisma.fplPlayer.count).mockResolvedValue(2);
    vi.mocked(prisma.fplPlayer.findMany).mockResolvedValue(
      [fakePlayer(1), fakePlayer(2)] as any,
    );

    const result = await getPlayers({ page: 1, limit: 30 });
    expect(result.hasMore).toBe(false);
  });

  it('clamps limit to a maximum of 100', async () => {
    await getPlayers({ limit: 9999 });

    const call = vi.mocked(prisma.fplPlayer.findMany).mock.calls[0][0] as any;
    expect(call.take).toBe(100);
  });

  it('defaults to page 1 when page is not provided', async () => {
    await getPlayers({});

    const call = vi.mocked(prisma.fplPlayer.findMany).mock.calls[0][0] as any;
    expect(call.skip).toBe(0);
  });

  it('calculates correct skip for page 2', async () => {
    await getPlayers({ page: 2, limit: 10 });

    const call = vi.mocked(prisma.fplPlayer.findMany).mock.calls[0][0] as any;
    expect(call.skip).toBe(10);
  });

  it('filters by teamId', async () => {
    await getPlayers({ teamId: 14 });

    const call = vi.mocked(prisma.fplPlayer.findMany).mock.calls[0][0] as any;
    expect(call.where.teamId).toBe(14);
  });

  it('filters by position', async () => {
    await getPlayers({ position: 4 });

    const call = vi.mocked(prisma.fplPlayer.findMany).mock.calls[0][0] as any;
    expect(call.where.position).toBe(4);
  });

  it('applies OR search filter when q is provided', async () => {
    await getPlayers({ q: 'Salah' });

    const call = vi.mocked(prisma.fplPlayer.findMany).mock.calls[0][0] as any;
    expect(call.where.OR).toBeDefined();
    expect(call.where.OR.length).toBeGreaterThan(0);
  });

  it('uses totalPoints desc as default sort', async () => {
    await getPlayers({});

    const call = vi.mocked(prisma.fplPlayer.findMany).mock.calls[0][0] as any;
    expect(call.orderBy[0]).toEqual({ totalPoints: 'desc' });
  });

  it('sorts by nowCost asc when sortBy=price-asc', async () => {
    await getPlayers({ sortBy: 'price-asc' });

    const call = vi.mocked(prisma.fplPlayer.findMany).mock.calls[0][0] as any;
    expect(call.orderBy[0]).toEqual({ nowCost: 'asc' });
  });
});

// ── getFixtures ───────────────────────────────────────────────────────────────

describe('getFixtures', () => {
  it('returns all fixtures with no filter', async () => {
    const fixtures = [{ id: 1, event: 34, teamHId: 1, teamAId: 2 }];
    vi.mocked(prisma.fplFixture.findMany).mockResolvedValue(fixtures as any);

    const result = await getFixtures({});

    expect(result).toEqual(fixtures);
    const call = vi.mocked(prisma.fplFixture.findMany).mock.calls[0][0] as any;
    expect(call.where).toEqual({});
  });

  it('filters by event', async () => {
    vi.mocked(prisma.fplFixture.findMany).mockResolvedValue([]);

    await getFixtures({ event: 34 });

    const call = vi.mocked(prisma.fplFixture.findMany).mock.calls[0][0] as any;
    expect(call.where.event).toBe(34);
  });

  it('filters by teamId with OR across home/away', async () => {
    vi.mocked(prisma.fplFixture.findMany).mockResolvedValue([]);

    await getFixtures({ teamId: 14 });

    const call = vi.mocked(prisma.fplFixture.findMany).mock.calls[0][0] as any;
    expect(call.where.OR).toEqual([{ teamHId: 14 }, { teamAId: 14 }]);
  });

  it('orders by kickoffTime ascending', async () => {
    vi.mocked(prisma.fplFixture.findMany).mockResolvedValue([]);

    await getFixtures({});

    const call = vi.mocked(prisma.fplFixture.findMany).mock.calls[0][0] as any;
    expect(call.orderBy).toEqual({ kickoffTime: 'asc' });
  });
});
