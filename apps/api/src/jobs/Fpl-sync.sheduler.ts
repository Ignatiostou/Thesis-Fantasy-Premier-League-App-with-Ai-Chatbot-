import { refreshFplData } from './Fpl-sync.service.js';

// ── Interval constants (ms) ───────────────────────────────────────────────────
const MIN      = 60_000;
const NORMAL   = 15 * MIN;   //  15 min — default
const MATCHDAY =  3 * MIN;   //   3 min — live scores / results coming in
const NIGHT    = 60 * MIN;   //  60 min — 01:00–06:00 UTC, nothing happening

// ── Helpers ───────────────────────────────────────────────────────────────────

function getIntervalMs(): number {
  const now  = new Date();
  const hour = now.getUTCHours();   // 0-23
  const day  = now.getUTCDay();     // 0=Sun 6=Sat

  // Dead of night — slow right down
  if (hour >= 1 && hour < 6) return NIGHT;

  // Match-day windows (UTC):
  //   Saturday  & Sunday  11:00-23:00
  //   Tuesday–Wednesday   18:00-23:00  (midweek European + League Cup nights)
  //   Monday              20:00-23:00  (occasional Monday night fixtures)
  const isSatOrSun  = day === 0 || day === 6;
  const isMidweek   = day === 2 || day === 3;  // Tue / Wed
  const isMondayNight = day === 1 && hour >= 20;

  if (isSatOrSun  && hour >= 11 && hour < 23) return MATCHDAY;
  if (isMidweek   && hour >= 18 && hour < 23) return MATCHDAY;
  if (isMondayNight && hour < 23)             return MATCHDAY;

  return NORMAL;
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

let _timer: ReturnType<typeof setTimeout> | null = null;
let _running = false;

async function tick() {
  if (_running) {
    // Previous run still in progress — skip this tick, reschedule
    console.log('[FPL Scheduler] Previous sync still running — skipping tick');
    scheduleNext();
    return;
  }

  _running = true;
  try {
    await refreshFplData();
  } catch (err) {
    console.error('[FPL Scheduler] Sync failed:', err);
  } finally {
    _running = false;
    scheduleNext();
  }
}

function scheduleNext() {
  const interval = getIntervalMs();
  const label    = interval === MATCHDAY ? '3 min (match-day)'
                 : interval === NIGHT    ? '60 min (night)'
                 :                         '15 min (normal)';
  console.log(`[FPL Scheduler] Next sync in ${label}`);
  _timer = setTimeout(tick, interval);
}

/**
 * Start the scheduler.
 * Runs an immediate sync on startup, then continues on the smart cadence.
 * Safe to call multiple times — won't create duplicate timers.
 */
export function startFplSyncScheduler() {
  if (_timer !== null) {
    console.log('[FPL Scheduler] Already running — ignoring duplicate start');
    return;
  }

  console.log('[FPL Scheduler] Starting — running initial sync now…');
  // Run immediately on boot so the data is fresh from the first request
  tick();
}

/**
 * Stop the scheduler gracefully (useful in tests or clean shutdown).
 */
export function stopFplSyncScheduler() {
  if (_timer !== null) {
    clearTimeout(_timer);
    _timer = null;
    console.log('[FPL Scheduler] Stopped');
  }
}
