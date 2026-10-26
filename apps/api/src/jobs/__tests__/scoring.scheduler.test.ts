// Covers the two-phase scoring fix from this session: a gameweek must be
// scored provisionally as soon as it's `finished`, then re-scored exactly
// once more when FPL later marks it `data_checked` (bonus points and stat
// corrections finalized) — never before, never more than once after.
//
// Each test uses its own gameweek id. scoreFinishedGameweeks keeps an
// in-memory Set of finalized gameweeks that persists for the lifetime of the
// module (by design — it's what lets a quiet poll skip a DB round trip), so
// reusing an id across tests would leak state between them.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../db/prisma.js', () => ({
  prisma: {
    fplEvent: { findMany: vi.fn() },
    gameweekScoringStatus: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}));

const syncPlayerGameweekStats = vi.fn();
vi.mock('../../modules/points/points-sync.service.js', () => ({
  syncPlayerGameweekStats: (...args: unknown[]) => syncPlayerGameweekStats(...args),
}));

const calculateAllTeamsForGameweek = vi.fn();
vi.mock('../../modules/points/points.service.js', () => ({
  calculateAllTeamsForGameweek: (...args: unknown[]) => calculateAllTeamsForGameweek(...args),
}));

import { prisma } from '../../db/prisma.js';
import { scoreFinishedGameweeks } from '../scoring.scheduler.js';

const mockDb = prisma as any;

function finishedEvent(id: number, dataChecked: boolean) {
  return { id, raw: { data_checked: dataChecked } };
}

/** Runs scoreFinishedGameweeks(), advancing past its internal 2s dedupe delay. */
async function run() {
  const p = scoreFinishedGameweeks();
  await vi.advanceTimersByTimeAsync(10_000);
  await p;
}

describe('scoreFinishedGameweeks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    syncPlayerGameweekStats.mockResolvedValue({ success: true, gameweek: 1, upserted: 15, skipped: 0 });
    calculateAllTeamsForGameweek.mockResolvedValue({ success: true, gameweek: 1, processedTeams: 4 });
    mockDb.gameweekScoringStatus.upsert.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does nothing when no gameweeks are finished', async () => {
    mockDb.fplEvent.findMany.mockResolvedValue([]);

    await run();

    expect(syncPlayerGameweekStats).not.toHaveBeenCalled();
    expect(calculateAllTeamsForGameweek).not.toHaveBeenCalled();
  });

  it('provisionally scores a gameweek that just finished (not yet data_checked)', async () => {
    mockDb.fplEvent.findMany.mockResolvedValue([finishedEvent(101, false)]);
    mockDb.gameweekScoringStatus.findUnique.mockResolvedValue(null); // no status row yet

    await run();

    expect(syncPlayerGameweekStats).toHaveBeenCalledWith(101);
    expect(calculateAllTeamsForGameweek).toHaveBeenCalledWith(101);
    expect(mockDb.gameweekScoringStatus.upsert).toHaveBeenCalledWith({
      where: { gameweek: 101 },
      update: { isFinal: false },
      create: { gameweek: 101, isFinal: false },
    });
  });

  it('does NOT re-score a provisionally-scored gameweek while still waiting for data_checked', async () => {
    mockDb.fplEvent.findMany.mockResolvedValue([finishedEvent(102, false)]);
    mockDb.gameweekScoringStatus.findUnique.mockResolvedValue({ gameweek: 102, isFinal: false });

    await run();

    // This is the exact bug this session fixed: previously the scheduler had
    // no way to distinguish "already scored, waiting" from "never scored" and
    // would just skip forever without ever doing the final correction pass.
    expect(syncPlayerGameweekStats).not.toHaveBeenCalled();
    expect(calculateAllTeamsForGameweek).not.toHaveBeenCalled();
    expect(mockDb.gameweekScoringStatus.upsert).not.toHaveBeenCalled();
  });

  it('re-scores exactly once when data_checked flips true (the final pass)', async () => {
    mockDb.fplEvent.findMany.mockResolvedValue([finishedEvent(103, true)]);
    mockDb.gameweekScoringStatus.findUnique.mockResolvedValue({ gameweek: 103, isFinal: false });

    await run();

    expect(syncPlayerGameweekStats).toHaveBeenCalledWith(103);
    expect(calculateAllTeamsForGameweek).toHaveBeenCalledWith(103);
    expect(mockDb.gameweekScoringStatus.upsert).toHaveBeenCalledWith({
      where: { gameweek: 103 },
      update: { isFinal: true },
      create: { gameweek: 103, isFinal: true },
    });
  });

  it('never touches a gameweek already marked final', async () => {
    mockDb.fplEvent.findMany.mockResolvedValue([finishedEvent(104, true)]);
    mockDb.gameweekScoringStatus.findUnique.mockResolvedValue({ gameweek: 104, isFinal: true });

    await run();

    expect(syncPlayerGameweekStats).not.toHaveBeenCalled();
    expect(calculateAllTeamsForGameweek).not.toHaveBeenCalled();
  });

  it('skips the in-memory-cached DB lookup on a later tick for an already-final gameweek', async () => {
    mockDb.fplEvent.findMany.mockResolvedValue([finishedEvent(105, true)]);
    mockDb.gameweekScoringStatus.findUnique.mockResolvedValue({ gameweek: 105, isFinal: true });

    await run(); // first tick: DB says final, gets cached in-memory
    mockDb.gameweekScoringStatus.findUnique.mockClear();

    await run(); // second tick: should skip the DB round trip entirely

    expect(mockDb.gameweekScoringStatus.findUnique).not.toHaveBeenCalled();
  });

  it('does not update status when scoring fails, so it retries next poll', async () => {
    mockDb.fplEvent.findMany.mockResolvedValue([finishedEvent(106, false)]);
    mockDb.gameweekScoringStatus.findUnique.mockResolvedValue(null);
    calculateAllTeamsForGameweek.mockRejectedValue(new Error('DB write failed'));

    await run();

    expect(mockDb.gameweekScoringStatus.upsert).not.toHaveBeenCalled();
  });

  it('a gameweek that failed its provisional attempt is retried on the next tick', async () => {
    mockDb.fplEvent.findMany.mockResolvedValue([finishedEvent(107, false)]);
    mockDb.gameweekScoringStatus.findUnique.mockResolvedValue(null);
    calculateAllTeamsForGameweek.mockRejectedValueOnce(new Error('transient failure'));

    await run(); // fails, no status written
    expect(mockDb.gameweekScoringStatus.upsert).not.toHaveBeenCalled();

    calculateAllTeamsForGameweek.mockResolvedValue({ success: true, gameweek: 107, processedTeams: 4 });
    await run(); // retried — status is still null in the mock, so this looks like a fresh attempt

    expect(syncPlayerGameweekStats).toHaveBeenCalledTimes(2);
    expect(mockDb.gameweekScoringStatus.upsert).toHaveBeenCalledWith({
      where: { gameweek: 107 },
      update: { isFinal: false },
      create: { gameweek: 107, isFinal: false },
    });
  });

  it('processes multiple finished gameweeks independently in one tick', async () => {
    mockDb.fplEvent.findMany.mockResolvedValue([
      finishedEvent(108, true),  // already final — should be skipped
      finishedEvent(109, false), // needs provisional scoring
    ]);
    mockDb.gameweekScoringStatus.findUnique.mockImplementation(({ where }: any) =>
      Promise.resolve(where.gameweek === 108 ? { gameweek: 108, isFinal: true } : null),
    );

    await run();

    expect(syncPlayerGameweekStats).toHaveBeenCalledTimes(1);
    expect(syncPlayerGameweekStats).toHaveBeenCalledWith(109);
  });
});
