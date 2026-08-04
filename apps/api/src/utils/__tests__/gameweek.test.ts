import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/prisma.js', () => ({
  prisma: {
    fplEvent: {
      findFirst: vi.fn(),
      findMany:  vi.fn(),
      findUnique: vi.fn(),
    },
    fplFixture: {
      findFirst: vi.fn(),
    },
    userPick: {
      count:      vi.fn(),
      findFirst:  vi.fn(),
      findMany:   vi.fn(),
      createMany: vi.fn(),
    },
  },
}));

import { prisma } from '../../db/prisma.js';
import {
  getLiveGameweekId,
  getEditableGameweekId,
  getEditableGameweek,
  getEffectiveDeadline,
} from '../gameweek.js';

const mockPrisma = prisma as any;

// ── getLiveGameweekId ─────────────────────────────────────────────────────────

describe('getLiveGameweekId', () => {

  beforeEach(() => vi.clearAllMocks());

  it('returns the id of the current gameweek', async () => {
    mockPrisma.fplEvent.findFirst.mockResolvedValue({ id: 28 });
    const result = await getLiveGameweekId();
    expect(result).toBe(28);
  });

  it('returns 1 as fallback when no current gameweek is found', async () => {
    mockPrisma.fplEvent.findFirst.mockResolvedValue(null);
    const result = await getLiveGameweekId();
    expect(result).toBe(1);
  });

  it('queries fplEvent with isCurrent: true', async () => {
    mockPrisma.fplEvent.findFirst.mockResolvedValue({ id: 10 });
    await getLiveGameweekId();
    expect(mockPrisma.fplEvent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isCurrent: true } }),
    );
  });
});

// ── getEffectiveDeadline ──────────────────────────────────────────────────────

describe('getEffectiveDeadline', () => {

  beforeEach(() => vi.clearAllMocks());

  it('returns 10 minutes before first fixture kickoff when fixture exists', async () => {
    const kickoff = new Date('2024-12-14T12:30:00Z');
    mockPrisma.fplEvent.findUnique.mockResolvedValue({ deadlineTime: null });
    mockPrisma.fplFixture.findFirst.mockResolvedValue({ kickoffTime: kickoff });

    const result = await getEffectiveDeadline(28);

    const expected = new Date(kickoff.getTime() - 10 * 60 * 1000);
    expect(result?.toISOString()).toBe(expected.toISOString());
  });

  it('falls back to event deadlineTime when no fixture kickoff exists', async () => {
    const deadline = new Date('2024-12-14T11:30:00Z');
    mockPrisma.fplEvent.findUnique.mockResolvedValue({ deadlineTime: deadline });
    mockPrisma.fplFixture.findFirst.mockResolvedValue(null);

    const result = await getEffectiveDeadline(28);
    expect(result?.toISOString()).toBe(deadline.toISOString());
  });

  it('returns null when neither fixture nor event deadline exists', async () => {
    mockPrisma.fplEvent.findUnique.mockResolvedValue({ deadlineTime: null });
    mockPrisma.fplFixture.findFirst.mockResolvedValue(null);

    const result = await getEffectiveDeadline(28);
    expect(result).toBeNull();
  });
});

// ── getEditableGameweek ───────────────────────────────────────────────────────

describe('getEditableGameweek', () => {

  beforeEach(() => vi.clearAllMocks());

  it('returns the first unfinished GW whose deadline has not passed', async () => {
    const futureDeadline = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

    mockPrisma.fplEvent.findMany.mockResolvedValue([
      { id: 28, name: 'Gameweek 28', deadlineTime: futureDeadline, finished: false, isCurrent: true },
    ]);
    mockPrisma.fplEvent.findUnique.mockResolvedValue({ deadlineTime: null });
    mockPrisma.fplFixture.findFirst.mockResolvedValue({ kickoffTime: futureDeadline });

    const result = await getEditableGameweek();
    expect(result?.id).toBe(28);
  });

  it('returns null when no unfinished gameweeks exist', async () => {
    mockPrisma.fplEvent.findMany.mockResolvedValue([]);
    mockPrisma.fplEvent.findFirst.mockResolvedValue(null);

    const result = await getEditableGameweek();
    expect(result).toBeNull();
  });

  it('skips past gameweeks whose deadline has already passed', async () => {
    const pastDeadline   = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
    const futureDeadline = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

    mockPrisma.fplEvent.findMany.mockResolvedValue([
      { id: 27, name: 'GW27', deadlineTime: pastDeadline,   finished: false, isCurrent: false },
      { id: 28, name: 'GW28', deadlineTime: futureDeadline, finished: false, isCurrent: true  },
    ]);

    // First call (GW27 fixture) returns past kickoff
    // Second call (GW28 fixture) returns future kickoff
    mockPrisma.fplFixture.findFirst
      .mockResolvedValueOnce({ kickoffTime: pastDeadline })
      .mockResolvedValueOnce({ kickoffTime: futureDeadline });

    mockPrisma.fplEvent.findUnique.mockResolvedValue({ deadlineTime: null });

    const result = await getEditableGameweek();
    expect(result?.id).toBe(28);
  });
});

// ── getEditableGameweekId ─────────────────────────────────────────────────────

describe('getEditableGameweekId', () => {

  beforeEach(() => vi.clearAllMocks());

  it('returns the id from getEditableGameweek', async () => {
    const futureDeadline = new Date(Date.now() + 3600000);
    mockPrisma.fplEvent.findMany.mockResolvedValue([
      { id: 34, name: 'GW34', deadlineTime: futureDeadline, finished: false, isCurrent: true },
    ]);
    mockPrisma.fplFixture.findFirst.mockResolvedValue({ kickoffTime: futureDeadline });
    mockPrisma.fplEvent.findUnique.mockResolvedValue({ deadlineTime: null });

    const result = await getEditableGameweekId();
    expect(result).toBe(34);
  });

  it('returns 1 as fallback when no editable gameweek found', async () => {
    mockPrisma.fplEvent.findMany.mockResolvedValue([]);
    mockPrisma.fplEvent.findFirst.mockResolvedValue(null);

    const result = await getEditableGameweekId();
    expect(result).toBe(1);
  });
});