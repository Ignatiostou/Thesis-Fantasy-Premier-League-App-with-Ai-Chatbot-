import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../utils/gameweek.js', () => ({
  getEditableGameweekId: vi.fn().mockResolvedValue(34),
  ensureSquadExistsForGameweek: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../db/prisma.js', () => ({
  prisma: {
    userTeam: { findUnique: vi.fn(), update: vi.fn() },
    userGameweekState: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    userChip: { findFirst: vi.fn(), create: vi.fn() },
    fplPlayer: { findMany: vi.fn(), findUnique: vi.fn() },
    userPick: { update: vi.fn() },
    userTransfer: { create: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { previewTransfers, getTransfersHistory } from '../transfers.service.js';
import { prisma } from '../../../db/prisma.js';

const mock = prisma as any;

function makePlayer(id: number, position: number, teamId: number, nowCost: number) {
  return {
    id,
    position,
    teamId,
    nowCost,
    webName: `Player${id}`,
    status: 'a',
    chanceOfPlayingNextRound: 100,
    team: { id: teamId, shortName: `T${teamId}` },
  };
}

function makePick(player: ReturnType<typeof makePlayer>, buyPrice = player.nowCost) {
  return {
    id: `pick-${player.id}`,
    playerId: player.id,
    position: player.position,
    isCaptain: false,
    isViceCaptain: false,
    isOnBench: false,
    benchOrder: null,
    buyPrice,
    player,
  };
}

const BASE_SQUAD = [
  makePick(makePlayer(1, 1, 10, 50)),
  makePick(makePlayer(2, 1, 11, 45)),

  makePick(makePlayer(3, 2, 12, 55)),
  makePick(makePlayer(4, 2, 13, 55)),
  makePick(makePlayer(5, 2, 14, 55)),
  makePick(makePlayer(6, 2, 15, 55)),
  makePick(makePlayer(7, 2, 16, 55)),

  makePick(makePlayer(8, 3, 17, 80)),
  makePick(makePlayer(9, 3, 18, 80)),
  makePick(makePlayer(10, 3, 19, 80)),
  makePick(makePlayer(11, 3, 20, 80)),
  makePick(makePlayer(12, 3, 21, 80)),

  makePick(makePlayer(13, 4, 22, 90)),
  makePick(makePlayer(14, 4, 23, 75)),
  makePick(makePlayer(15, 4, 24, 70)),
];

const gwState = {
  id: 'gws-1',
  userTeamId: 'team-1',
  gameweek: 34,
  freeTransfers: 1,
  transfersMade: 0,
  pointsHit: 0,
  activeChip: null,
};

function setupValidContext() {
  mock.userTeam.findUnique.mockResolvedValue({
    id: 'team-1',
    name: 'My Team',
    budget: 200,
    season: '2025-26',
    picks: BASE_SQUAD,
  });

  mock.userGameweekState.findUnique.mockResolvedValue(gwState);
  mock.userGameweekState.findFirst.mockResolvedValue(null);
  mock.userGameweekState.create.mockResolvedValue(gwState);
  mock.userChip.findFirst.mockResolvedValue(null);
}

beforeEach(() => {
  vi.clearAllMocks();
  setupValidContext();
});

describe('previewTransfers', () => {
  it('returns NO_TEAM when user has no team', async () => {
    mock.userTeam.findUnique.mockResolvedValue(null);

    const result = await previewTransfers('user-1', [
      { outPlayerId: 8, inPlayerId: 20 },
    ]);

    expect(result.ok).toBe(false);
    expect((result as any).errors).toContain('NO_TEAM');
  });

  it('returns NO_TRANSFERS_SELECTED when transfer list is empty', async () => {
    const result = await previewTransfers('user-1', []);

    expect(result.ok).toBe(false);
    expect((result as any).errors).toContain('NO_TRANSFERS_SELECTED');
  });

  it('returns an error when outgoing player is not in the squad', async () => {
    mock.fplPlayer.findMany.mockResolvedValue([
      makePlayer(20, 3, 30, 75),
    ]);

    const result = await previewTransfers('user-1', [
      { outPlayerId: 999, inPlayerId: 20 },
    ]);

    expect(result.ok).toBe(false);
    expect((result as any).errors).toContain('OUT_PLAYER_NOT_IN_TEAM:999');
  });

  it('returns an error when incoming player is already in the squad', async () => {
    mock.fplPlayer.findMany.mockResolvedValue([
      BASE_SQUAD[7].player,
      BASE_SQUAD[8].player,
    ]);

    const result = await previewTransfers('user-1', [
      { outPlayerId: 8, inPlayerId: 9 },
    ]);

    expect(result.ok).toBe(false);
    expect((result as any).errors).toContain('IN_PLAYER_ALREADY_IN_TEAM:9');
  });

  it('returns a position mismatch error when swapping different positions', async () => {
    mock.fplPlayer.findMany.mockResolvedValue([
      BASE_SQUAD[7].player,
      makePlayer(20, 4, 30, 75),
    ]);

    const result = await previewTransfers('user-1', [
      { outPlayerId: 8, inPlayerId: 20 },
    ]);

    expect(result.ok).toBe(false);
    expect((result as any).errors).toContain('POSITION_MISMATCH:8->20');
  });

  it('returns BUDGET_EXCEEDED when transfer costs more than available budget', async () => {
    mock.userTeam.findUnique.mockResolvedValue({
      id: 'team-1',
      name: 'My Team',
      budget: 0,
      season: '2025-26',
      picks: BASE_SQUAD,
    });

    mock.fplPlayer.findMany.mockResolvedValue([
      BASE_SQUAD[7].player,
      makePlayer(20, 3, 30, 300),
    ]);

    const result = await previewTransfers('user-1', [
      { outPlayerId: 8, inPlayerId: 20 },
    ]);

    expect(result.ok).toBe(false);
    expect((result as any).errors).toContain('BUDGET_EXCEEDED');
  });

  it('returns successful preview with correct budget calculation', async () => {
    mock.fplPlayer.findMany.mockResolvedValue([
      BASE_SQUAD[7].player,
      makePlayer(20, 3, 30, 75),
    ]);

    const result = await previewTransfers('user-1', [
      { outPlayerId: 8, inPlayerId: 20 },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const summary = result.summary!;
    expect(summary.budgetLeftAfter).toBe(205);
  });

  it('marks transfers beyond free transfers as hits', async () => {
    mock.fplPlayer.findMany.mockResolvedValue([
      BASE_SQUAD[7].player,
      BASE_SQUAD[8].player,
      makePlayer(20, 3, 30, 75),
      makePlayer(21, 3, 31, 75),
    ]);

    const result = await previewTransfers('user-1', [
      { outPlayerId: 8, inPlayerId: 20 },
      { outPlayerId: 9, inPlayerId: 21 },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const cart = result.cart!;
    const summary = result.summary!;
    expect(cart[0].isHit).toBe(false);
    expect(cart[1].isHit).toBe(true);
    expect(summary.hitCostAdded).toBe(4);
  });

  it('correctly calculates sell price when player value has risen', async () => {
    const risenPlayer = makePlayer(8, 3, 17, 100);
    const squad = BASE_SQUAD.map((p) =>
      p.playerId === 8 ? makePick(risenPlayer, 80) : p,
    );

    mock.userTeam.findUnique.mockResolvedValue({
      id: 'team-1',
      name: 'My Team',
      budget: 0,
      season: '2025-26',
      picks: squad,
    });

    mock.fplPlayer.findMany.mockResolvedValue([
      risenPlayer,
      makePlayer(20, 3, 30, 75),
    ]);

    const result = await previewTransfers('user-1', [
      { outPlayerId: 8, inPlayerId: 20 },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const cart = result.cart!;
    expect(cart[0].outSellPrice).toBe(90);
  });

  it('sell price equals nowCost when player value has dropped', async () => {
    const droppedPlayer = makePlayer(8, 3, 17, 70);
    const squad = BASE_SQUAD.map((p) =>
      p.playerId === 8 ? makePick(droppedPlayer, 80) : p,
    );

    mock.userTeam.findUnique.mockResolvedValue({
      id: 'team-1',
      name: 'My Team',
      budget: 200,
      season: '2025-26',
      picks: squad,
    });

    mock.fplPlayer.findMany.mockResolvedValue([
      droppedPlayer,
      makePlayer(20, 3, 30, 75),
    ]);

    const result = await previewTransfers('user-1', [
      { outPlayerId: 8, inPlayerId: 20 },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const cart = result.cart!;
    expect(cart[0].outSellPrice).toBe(70);
  });
});

describe('getTransfersHistory', () => {
  it('returns { items: [] } when user has no team', async () => {
    mock.userTeam.findUnique.mockResolvedValue(null);

    const result = await getTransfersHistory('user-1');

    expect(result).toEqual({ items: [] });
  });

  it('returns mapped transfer history for the user', async () => {
    mock.userTeam.findUnique.mockResolvedValue({ id: 'team-1' });

    mock.userTransfer.findMany.mockResolvedValue([
      {
        id: 'transfer-1',
        gameweek: 34,
        playerInId: 20,
        playerOutId: 8,
        playerInCost: 75,
        playerOutCost: 80,
        isHit: false,
        createdAt: new Date('2025-04-25T12:00:00Z'),
        playerIn: { webName: 'Salah' },
        playerOut: { webName: 'Son' },
      },
    ]);

    const result = await getTransfersHistory('user-1');

    expect(result.items).toHaveLength(1);
    expect(result.items[0].playerInWebName).toBe('Salah');
    expect(result.items[0].playerOutWebName).toBe('Son');
    expect(result.items[0].isHit).toBe(false);
    expect(result.items[0].gameweek).toBe(34);
  });

  it('filters by gameweek when provided', async () => {
    mock.userTeam.findUnique.mockResolvedValue({ id: 'team-1' });
    mock.userTransfer.findMany.mockResolvedValue([]);

    await getTransfersHistory('user-1', 34);

    const call = mock.userTransfer.findMany.mock.calls[0][0];
    expect(call.where.gameweek).toBe(34);
  });

  it('does not filter by gameweek when not provided', async () => {
    mock.userTeam.findUnique.mockResolvedValue({ id: 'team-1' });
    mock.userTransfer.findMany.mockResolvedValue([]);

    await getTransfersHistory('user-1');

    const call = mock.userTransfer.findMany.mock.calls[0][0];
    expect(call.where.gameweek).toBeUndefined();
  });
});