// Covers the season-boundary fix from this session (tick() falling back to
// predictUpcomingGameweekIfMissing when no gameweek has ever finished, since
// the normal "retrain after a completed GW" flow has no path to GW1 of a new
// season) — plus the pre-existing normal-path branches, to catch any
// regression in how the two now interact inside the same tick().

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/prisma.js', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    fplEvent: { findUnique: vi.fn() },
    playerPrediction: { count: vi.fn() },
    playerGameweekStat: { count: vi.fn() },
  },
}));

vi.mock('../ml-pipeline.service.js', () => ({
  mlModelExists: vi.fn(),
  runMlBackfill: vi.fn(),
  runMlPipeline: vi.fn(),
  runMlPredictOnly: vi.fn(),
}));

const syncPlayerGameweekStats = vi.fn();
vi.mock('../../modules/points/points-sync.service.js', () => ({
  syncPlayerGameweekStats: (...args: unknown[]) => syncPlayerGameweekStats(...args),
}));

import { prisma } from '../../db/prisma.js';
import { mlModelExists, runMlPipeline, runMlPredictOnly } from '../ml-pipeline.service.js';
import { tick } from '../ml-pipeline.scheduler.js';

const mockDb = prisma as any;

/**
 * latestFinalized: what latestFinalizedGameweek()'s query should resolve to.
 * upcoming: what currentUpcomingGameweek()'s query should resolve to.
 * Both functions hit prisma.$queryRaw with different SQL text, so the mock
 * branches on a distinguishing substring of the tagged-template SQL.
 */
function mockGameweekQueries(opts: { latestFinalized?: number | null; upcoming?: number | null }) {
  mockDb.$queryRaw.mockImplementation((strings: TemplateStringsArray) => {
    const sql = strings.join('');
    if (sql.includes('data_checked')) {
      return Promise.resolve(
        opts.latestFinalized == null ? [] : [{ id: opts.latestFinalized }],
      );
    }
    if (sql.includes('isCurrent')) {
      return Promise.resolve(opts.upcoming == null ? [] : [{ id: opts.upcoming }]);
    }
    return Promise.resolve([]);
  });
}

describe('tick — season boundary (no gameweek has ever finished)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when no trained model exists yet', async () => {
    mockGameweekQueries({ latestFinalized: null, upcoming: 1 });
    vi.mocked(mlModelExists).mockReturnValue(false);

    await tick();

    expect(runMlPredictOnly).not.toHaveBeenCalled();
  });

  it('does nothing when fixtures have not synced yet (no upcoming GW found)', async () => {
    mockGameweekQueries({ latestFinalized: null, upcoming: null });
    vi.mocked(mlModelExists).mockReturnValue(true);

    await tick();

    expect(runMlPredictOnly).not.toHaveBeenCalled();
  });

  it('predicts the upcoming gameweek with the existing model when no predictions exist yet', async () => {
    mockGameweekQueries({ latestFinalized: null, upcoming: 1 });
    vi.mocked(mlModelExists).mockReturnValue(true);
    mockDb.playerPrediction.count.mockResolvedValue(0);

    await tick();

    expect(runMlPredictOnly).toHaveBeenCalledWith(1);
    // This is the season-boundary fix itself: no retrain, straight to predict.
    expect(runMlPipeline).not.toHaveBeenCalled();
  });

  it('does not re-predict once GW1 already has live predictions', async () => {
    mockGameweekQueries({ latestFinalized: null, upcoming: 1 });
    vi.mocked(mlModelExists).mockReturnValue(true);
    mockDb.playerPrediction.count.mockResolvedValue(1);

    await tick();

    expect(runMlPredictOnly).not.toHaveBeenCalled();
  });

  it('does not throw when the predict-only run fails, so the scheduler can retry next tick', async () => {
    mockGameweekQueries({ latestFinalized: null, upcoming: 1 });
    vi.mocked(mlModelExists).mockReturnValue(true);
    mockDb.playerPrediction.count.mockResolvedValue(0);
    vi.mocked(runMlPredictOnly).mockRejectedValue(new Error('python process crashed'));

    await expect(tick()).resolves.toBeUndefined();
  });
});

describe('tick — normal path (a gameweek has finished)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when the completed gameweek was the final one of the season', async () => {
    mockGameweekQueries({ latestFinalized: 38, upcoming: 1 });
    mockDb.fplEvent.findUnique.mockResolvedValue(null); // GW39 doesn't exist

    await tick();

    expect(runMlPipeline).not.toHaveBeenCalled();
  });

  it('does nothing when predictions for the next gameweek already exist', async () => {
    mockGameweekQueries({ latestFinalized: 10, upcoming: 11 });
    mockDb.fplEvent.findUnique.mockResolvedValue({ id: 11 });
    mockDb.playerPrediction.count.mockResolvedValue(1);

    await tick();

    expect(runMlPipeline).not.toHaveBeenCalled();
  });

  it('runs the pipeline directly when stats for the completed GW are already imported', async () => {
    mockGameweekQueries({ latestFinalized: 10, upcoming: 11 });
    mockDb.fplEvent.findUnique.mockResolvedValue({ id: 11 });
    mockDb.playerPrediction.count.mockResolvedValue(0);
    mockDb.playerGameweekStat.count.mockResolvedValue(500); // already synced

    await tick();

    expect(syncPlayerGameweekStats).not.toHaveBeenCalled();
    expect(runMlPipeline).toHaveBeenCalledWith(10);
  });

  it('syncs the completed GW stats first when they are missing, then runs the pipeline', async () => {
    mockGameweekQueries({ latestFinalized: 10, upcoming: 11 });
    mockDb.fplEvent.findUnique.mockResolvedValue({ id: 11 });
    mockDb.playerPrediction.count.mockResolvedValue(0);
    mockDb.playerGameweekStat.count.mockResolvedValue(0); // not synced yet

    await tick();

    expect(syncPlayerGameweekStats).toHaveBeenCalledWith(10);
    expect(runMlPipeline).toHaveBeenCalledWith(10);
  });

  it('does not throw when the pipeline run fails, so the scheduler can retry next tick', async () => {
    mockGameweekQueries({ latestFinalized: 10, upcoming: 11 });
    mockDb.fplEvent.findUnique.mockResolvedValue({ id: 11 });
    mockDb.playerPrediction.count.mockResolvedValue(0);
    mockDb.playerGameweekStat.count.mockResolvedValue(500);
    vi.mocked(runMlPipeline).mockRejectedValue(new Error('training crashed'));

    await expect(tick()).resolves.toBeUndefined();
  });
});
