// ─────────────────────────────────────────────────────────────────────────────
// ML pipeline scheduler.
//
// Every 15 minutes it checks whether a gameweek has newly completed:
//   - the FPL event must be finished AND data_checked (bonus points, stats
//     and totals finalized by FPL — not just the last match ended)
//   - player_gameweek_stats must contain the completed GW's rows
//     (imported by the scoring scheduler; synced here as a fallback)
//   - predictions for the NEXT gameweek must not exist yet
//
// When all conditions hold it runs the Python pipeline once:
//   import results → feature engineering → retrain → validate → predict
//   next GW → store predictions → chatbot picks them up.
//
// On startup, if no trained model exists at all, it triggers the one-time
// historical backfill automatically (disable with ML_AUTO_BACKFILL=false).
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from '../db/prisma.js';
import { mlModelExists, runMlBackfill, runMlPipeline } from './ml-pipeline.service.js';

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

async function tick(): Promise<void> {
  if (_running) {
    console.log('[ML Scheduler] Previous run still in progress — skipping tick');
    return;
  }

  const completedGw = await latestFinalizedGameweek();
  if (completedGw === null) return; // season not started / no finalized data yet

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
  const existingPredictions = await prisma.playerPrediction.count({
    where: {
      gameweek: completedGw + 1,
      NOT: { modelVersion: { startsWith: 'backtest' } },
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
