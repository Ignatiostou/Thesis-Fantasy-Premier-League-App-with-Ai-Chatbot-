import { prisma } from '../db/prisma.js';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// In-memory mirror of status rows with isFinal=true, so quiet ticks skip the
// per-gameweek status query. Safe across restarts: it is rebuilt from the DB.
const finalScoredGws = new Set<number>();

type ScoringPhase = 'provisional' | 'final';

function isDataChecked(raw: unknown): boolean {
  return typeof raw === 'object' && raw !== null && (raw as { data_checked?: unknown }).data_checked === true;
}

async function syncAndScore(gameweek: number, phase: ScoringPhase) {
  // Small delay to avoid deadlock with the FPL sync job which also writes fplPlayer
  await new Promise((r) => setTimeout(r, 2000));

  // 1. Sync latest player stats from FPL live API
  const { syncPlayerGameweekStats } = await import('../modules/points/points-sync.service.js');
  const syncResult = await syncPlayerGameweekStats(gameweek);
  console.log(`[Scoring] GW${gameweek} stats synced (${phase}) — ${syncResult.upserted} players`);

  // 2. Score all teams
  const { calculateAllTeamsForGameweek } = await import('../modules/points/points.service.js');
  const scoreResult = await calculateAllTeamsForGameweek(gameweek);
  console.log(`[Scoring] GW${gameweek} scored (${phase}) — ${scoreResult.processedTeams} teams`);
}

export async function scoreFinishedGameweeks() {
  const finishedEvents = await prisma.fplEvent.findMany({
    where: { finished: true },
    select: { id: true, raw: true },
    orderBy: { id: 'asc' },
  });

  for (const event of finishedEvents) {
    if (finalScoredGws.has(event.id)) continue;

    const status = await prisma.gameweekScoringStatus.findUnique({
      where: { gameweek: event.id },
    });

    if (status?.isFinal) {
      finalScoredGws.add(event.id);
      continue;
    }

    const dataChecked = isDataChecked(event.raw);

    // Already provisionally scored and FPL hasn't finalized the data yet —
    // nothing new to compute, wait for data_checked.
    if (status && !dataChecked) continue;

    const phase: ScoringPhase = dataChecked ? 'final' : 'provisional';
    console.log(
      status
        ? `[Scoring] GW${event.id} data finalized — re-scoring (final)…`
        : `[Scoring] GW${event.id} finished — scoring (${phase})…`,
    );

    try {
      await syncAndScore(event.id, phase);

      await prisma.gameweekScoringStatus.upsert({
        where: { gameweek: event.id },
        update: { isFinal: dataChecked },
        create: { gameweek: event.id, isFinal: dataChecked },
      });

      if (dataChecked) finalScoredGws.add(event.id);
    } catch (err) {
      console.error(`[Scoring] GW${event.id} ${phase} scoring failed:`, err);
      // Status not updated — will retry on next poll
    }
  }
}

let _timer: ReturnType<typeof setInterval> | null = null;

export function startScoringScheduler() {
  if (_timer) {
    console.log('[Scoring Scheduler] Already running');
    return;
  }

  console.log('[Scoring Scheduler] Starting — polling every 5 min (provisional on finished, final on data_checked)');

  // Run immediately on boot to catch any GWs we missed while offline
  scoreFinishedGameweeks().catch((err) =>
    console.error('[Scoring Scheduler] Initial run failed:', err),
  );

  _timer = setInterval(() => {
    scoreFinishedGameweeks().catch((err) =>
      console.error('[Scoring Scheduler] Poll failed:', err),
    );
  }, POLL_INTERVAL_MS);
}

export function stopScoringScheduler() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    console.log('[Scoring Scheduler] Stopped');
  }
}
