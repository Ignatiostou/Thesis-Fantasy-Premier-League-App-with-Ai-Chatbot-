import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db/prisma.js', () => ({
  prisma: {
    fplPlayer: { findMany: vi.fn() },
  },
}));

// findMentionedPlayers runs every name-matched candidate through the
// eligibility gate (buildEligibilitySnapshots + checkEligibility), which
// needs its own DB queries (fplEvent, playerGameweekStat) unrelated to what
// this file tests (tokenizing/ranking). Mock it out so every candidate the
// name-match query returns is treated as eligible, keeping these tests
// focused on ranking behaviour rather than eligibility-DB shape.
vi.mock('../player-eligibility.service.js', () => ({
  buildEligibilitySnapshots: vi.fn((ids: number[]) =>
    new Map(ids.map((id) => [id, {
      playerId: id, status: 'a', chanceOfPlayingNextRound: 100,
      minutesLast3Gw: 90, appearsInRecentGw: true, teamId: 1, position: 3,
    }])),
  ),
  checkEligibility: vi.fn().mockReturnValue({ eligible: true, reasons: [] }),
}));

import { prisma } from '../../../db/prisma.js';
import { findMentionedPlayers } from '../player-search.service.js';

const mockDb = prisma as any;

function makePlayer(
  id: number,
  webName: string,
  firstName: string,
  secondName: string,
) {
  return {
    id,
    webName,
    firstName,
    secondName,
    team: {
      id: 1,
      name: 'Arsenal',
      shortName: 'ARS',
    },
  };
}

describe('findMentionedPlayers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array for empty message', async () => {
    mockDb.fplPlayer.findMany.mockResolvedValue([]);

    expect(await findMentionedPlayers('')).toEqual([]);
    expect(mockDb.fplPlayer.findMany).not.toHaveBeenCalled();
  });

  it('returns empty array when message has only short tokens (< 3 chars)', async () => {
    mockDb.fplPlayer.findMany.mockResolvedValue([]);

    expect(await findMentionedPlayers('hi or vs')).toEqual([]);
    expect(mockDb.fplPlayer.findMany).not.toHaveBeenCalled();
  });

  it('queries DB with tokenized terms from the message', async () => {
    mockDb.fplPlayer.findMany.mockResolvedValue([]);

    await findMentionedPlayers('should i transfer salah');

    expect(mockDb.fplPlayer.findMany).toHaveBeenCalledOnce();
    expect(mockDb.fplPlayer.findMany.mock.calls[0][0].where.OR).toBeDefined();
  });

  it('removes duplicate tokens before querying', async () => {
    mockDb.fplPlayer.findMany.mockResolvedValue([]);

    await findMentionedPlayers('salah salah salah');

    const call = mockDb.fplPlayer.findMany.mock.calls[0][0];

    // 1 unique token: salah
    // Usually 3 OR clauses: webName, firstName, secondName
    expect(call.where.OR).toHaveLength(3);
  });

  it('ranks exact webName match higher than partial match', async () => {
    mockDb.fplPlayer.findMany.mockResolvedValue([
      makePlayer(2, 'Salazar', 'Pedro', 'Salazar'),
      makePlayer(1, 'Salah', 'Mohamed', 'Salah'),
    ]);

    const result = await findMentionedPlayers('salah');

    expect(result[0].webName).toBe('Salah');
  });

  it('respects the limit parameter', async () => {
    mockDb.fplPlayer.findMany.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) =>
        makePlayer(i + 1, `Player${i}`, 'First', 'Last'),
      ),
    );

    expect(await findMentionedPlayers('player', 3)).toHaveLength(3);
  });

  it('strips punctuation from message before tokenizing', async () => {
    mockDb.fplPlayer.findMany.mockResolvedValue([]);

    await findMentionedPlayers('salah, haaland!');

    expect(mockDb.fplPlayer.findMany).toHaveBeenCalledOnce();
    expect(
      JSON.stringify(mockDb.fplPlayer.findMany.mock.calls[0][0]),
    ).toContain('salah');
  });

  it('is case-insensitive in tokenization', async () => {
    mockDb.fplPlayer.findMany.mockResolvedValue([]);

    await findMentionedPlayers('SALAH HAALAND');

    const query = JSON.stringify(
      mockDb.fplPlayer.findMany.mock.calls[0][0],
    ).toLowerCase();

    expect(query).toContain('salah');
    expect(query).toContain('haaland');
  });

  it('returns empty array when no players match', async () => {
    mockDb.fplPlayer.findMany.mockResolvedValue([]);

    expect(
      await findMentionedPlayers('completely unknown xyz'),
    ).toEqual([]);
  });
});