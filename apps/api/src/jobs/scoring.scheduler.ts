
// ─────────────────────────────────────────────────────────────────────────────
// Watches for gameweeks that have finished but haven't been scored yet.
// Runs every 5 minutes. When it detects a finished GW with no scores, it:
//   1. Syncs live player stats from the FPL API
//   2. Calculates scores for all teams
//   3. Marks the GW as processed (via a simple in-memory + DB check)
//
// Relies on: points.service.calculateAllTeamsForGameweek
//            points-sync.service.syncPlayerGameweekStats
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from '../db/prisma.js';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// In-memory set of GW IDs we've already scored this process lifetime.
// Prevents double-scoring on rapid restarts.
const scoredGws = new Set<number>();

async function scoreFinishedGameweeks() {
  // Find gameweeks that are marked finished
  const finishedEvents = await prisma.fplEvent.findMany({
    where: { finished: true },
    select: { id: true, name: true },
    orderBy: { id: 'asc' },
  });

  for (const event of finishedEvents) {
    if (scoredGws.has(event.id)) continue;

    // Check if any team already has a score for this GW
    const existingScores = await prisma.userGameweekScore.count({
      where: { gameweek: event.id },
    });

    // Check how many teams exist
    const teamCount = await prisma.userTeam.count();

    // If scores already exist for all teams, mark as done and skip
    if (teamCount > 0 && existingScores >= teamCount) {
      console.log(`[Scoring] GW${event.id} already fully scored (${existingScores}/${teamCount} teams) — skipping`);
      scoredGws.add(event.id);
      continue;
    }

    console.log(`[Scoring] GW${event.id} finished — scoring ${teamCount} teams…`);

    // Small delay to avoid deadlock with the FPL sync job which also writes fplPlayer
    await new Promise((r) => setTimeout(r, 2000));

    try {
      // 1. Sync latest player stats from FPL live API
      const { syncPlayerGameweekStats } = await import('../modules/points/points-sync.service.js');
      const syncResult = await syncPlayerGameweekStats(event.id);
      console.log(`[Scoring] GW${event.id} stats synced — ${syncResult.upserted} players`);

      // 2. Score all teams
      const { calculateAllTeamsForGameweek } = await import('../modules/points/points.service.js');
      const scoreResult = await calculateAllTeamsForGameweek(event.id);
      console.log(`[Scoring] GW${event.id} scored — ${scoreResult.processedTeams} teams`);

      scoredGws.add(event.id);
    } catch (err) {
      console.error(`[Scoring] GW${event.id} scoring failed:`, err);
      // Don't add to scoredGws — will retry on next poll
    }
  }
}

let _timer: ReturnType<typeof setInterval> | null = null;

export function startScoringScheduler() {
  if (_timer) {
    console.log('[Scoring Scheduler] Already running');
    return;
  }

  console.log('[Scoring Scheduler] Starting — polling every 5 min for finished GWs');

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