import { prisma } from '../db/prisma.js';
import { mlModelExists, runMlBackfill, runMlPipeline, runMlPredictOnly } from './ml-pipeline.service.js';

const POLL_INTERVAL_MS = Number(process.env.ML_POLL_MINUTES ?? 15) * 60 * 1000;

let _timer: ReturnType<typeof setInterval> | null = null;
let _running = false;            // lock: never run two pipelines concurrently
let _seasonCompleteLogged = false;

/** Latest GW that is finished AND data_checked according to FPL. */
async function latestFinalizedGameweek(): Promise<number | null> {
  const rows = await prisma.$queryRaw<{ id: number }[]>`
    SELECT id FROM fpl_events
    WHERE finished = TRUE
      AND COALESCE((raw->>'data_checked')::boolean, FALSE) = TRUE
    ORDER BY id DESC
    LIMIT 1
  `;
  return rows.length ? Number(rows[0].id) : null;
}

/**
 * The gameweek FPL currently considers current/next.
 * Mirrors predict_next_gw.py's own CURRENT_GAMEWEEK_QUERY so the Node trigger
 * and the Python resolution agree on which GW is "up next".
 */
async function currentUpcomingGameweek(): Promise<number | null> {
  const rows = await prisma.$queryRaw<{ id: number }[]>`
    SELECT id FROM fpl_events
    WHERE
        "isCurrent" = TRUE
        OR (raw->>'is_next')::boolean = TRUE
    ORDER BY
        CASE WHEN (raw->>'is_next')::boolean = TRUE THEN 0 ELSE 1 END,
        id ASC
    LIMIT 1
  `;
  return rows.length ? Number(rows[0].id) : null;
}

/**
 * Season-boundary fallback: no gameweek has ever finished (yet), so the
 * normal completed-GW flow has nothing to hang off. If there's a trained
 * model and the upcoming GW has no predictions yet, generate them once with
 * the carried-over model — no retrain, there's no same-season data for that.
 */
async function predictUpcomingGameweekIfMissing(): Promise<void> {
  if (!mlModelExists()) return; // no model yet — the startup backfill owns this case

  const upcomingGw = await currentUpcomingGameweek();
  if (upcomingGw === null) return; // fixtures not synced yet

  const existingPredictions = await prisma.playerPrediction.count({
    where: {
      gameweek: upcomingGw,
      NOT: { modelVersion: { startsWith: 'backtest' } },
    },
  });
  if (existingPredictions > 0) return;

  console.log(
    `[ML Scheduler] No finalized gameweek yet (season boundary) — ` +
    `generating predictions for GW${upcomingGw} with the existing model`,
  );
  _running = true;
  try {
    await runMlPredictOnly(upcomingGw);
    console.log(`[ML Scheduler] Predictions for GW${upcomingGw} are now available`);
  } catch (err) {
    console.error(`[ML Scheduler] Predict-only run for GW${upcomingGw} failed (will retry next tick):`, err);
  } finally {
    _running = false;
  }
}

export async function tick(): Promise<void> {
  if (_running) {
    console.log('[ML Scheduler] Previous run still in progress — skipping tick');
    return;
  }

  const completedGw = await latestFinalizedGameweek();
  if (completedGw === null) {
    // Nothing has ever finished (season boundary, or brand-new deployment
    // mid-season). Fall back to predicting the upcoming GW directly.
    await predictUpcomingGameweekIfMissing();
    return;
  }

  // Season over? (no next event to predict)
  const nextEvent = await prisma.fplEvent.findUnique({ where: { id: completedGw + 1 } });
  if (!nextEvent) {
    if (!_seasonCompleteLogged) {
      console.log(`[ML Scheduler] GW${completedGw} was the final gameweek — season complete. ` +
        'Model stays ready; run scripts/rollover_season.py before the new season.');
      _seasonCompleteLogged = true;
    }
    return;
  }

  // Already processed? LIVE predictions for the next GW mean the pipeline ran.
  // Backtest rows (model_version backtest_*) must not count — they are
  // historical research data, not the live prediction for the upcoming GW.
  // Provisional rows (model_version provisional_*) must not count either —
  // they're the season-boundary carried-over-model stopgap
  // (predictUpcomingGameweekIfMissing, below), generated with no retrain
  // because nothing had finalized yet. Now that completedGw HAS finalized,
  // this is exactly the case that needs a real retrain to replace them —
  // counting them as "already processed" would leave the stopgap numbers in
  // place for the rest of the season.
  const existingPredictions = await prisma.playerPrediction.count({
    where: {
      gameweek: completedGw + 1,
      NOT: {
        OR: [
          { modelVersion: { startsWith: 'backtest' } },
          { modelVersion: { startsWith: 'provisional_' } },
        ],
      },
    },
  });
  if (existingPredictions > 0) return;

  // Make sure the completed GW's stats are in the DB before training on them.
  const statRows = await prisma.playerGameweekStat.count({ where: { gameweek: completedGw } });
  if (statRows === 0) {
    console.log(`[ML Scheduler] GW${completedGw} finalized but stats not imported yet — syncing now`);
    const { syncPlayerGameweekStats } = await import('../modules/points/points-sync.service.js');
    await syncPlayerGameweekStats(completedGw);
  }

  console.log(`[ML Scheduler] New completed gameweek detected: GW${completedGw} — running pipeline`);
  _running = true;
  try {
    await runMlPipeline(completedGw);
    console.log(`[ML Scheduler] Predictions for GW${completedGw + 1} are now available`);
  } catch (err) {
    console.error('[ML Scheduler] Pipeline run failed (will retry next tick):', err);
  } finally {
    _running = false;
  }
}

async function bootstrapIfNeeded(): Promise<void> {
  if (mlModelExists()) return;
  if (process.env.ML_AUTO_BACKFILL === 'false') {
    console.warn('[ML Scheduler] No trained model found. Run: python scripts/backfill_season.py');
    return;
  }

  console.log('[ML Scheduler] No trained model found — starting one-time historical backfill');
  _running = true;
  try {
    await runMlBackfill();
  } catch (err) {
    console.error('[ML Scheduler] Historical backfill failed:', err);
  } finally {
    _running = false;
  }
}

export function startMlPipelineScheduler(): void {
  if (_timer) {
    console.log('[ML Scheduler] Already running');
    return;
  }

  console.log(`[ML Scheduler] Starting — checking every ${POLL_INTERVAL_MS / 60000} min for completed gameweeks`);

  // Boot sequence: backfill if there is no model yet, then check immediately.
  bootstrapIfNeeded()
    .then(() => tick())
    .catch((err) => console.error('[ML Scheduler] Initial run failed:', err));

  _timer = setInterval(() => {
    tick().catch((err) => console.error('[ML Scheduler] Tick failed:', err));
  }, POLL_INTERVAL_MS);
}

export function stopMlPipelineScheduler(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    console.log('[ML Scheduler] Stopped');
  }
}
