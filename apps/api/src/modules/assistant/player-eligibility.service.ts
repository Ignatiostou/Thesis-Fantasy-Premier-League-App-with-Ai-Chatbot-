import { prisma } from '../../db/prisma.js';
import { getLiveGameweekId } from '../../utils/gameweek.js';

// ── Public types ──────────────────────────────────────────────────────────────

export interface EligibilityResult {
  eligible: boolean;
  reasons:  string[];   // empty array if eligible; populated reasons if not
}

export interface EligibilitySnapshot {
  // The minimal facts about each player needed to gate them.
  // Built once per request, indexed by playerId.
  playerId:                number;
  status:                  string;
  chanceOfPlayingNextRound:number | null;
  minutesLast3Gw:          number;     // total minutes in the last 3 finished GWs
  appearsInRecentGw:       boolean;    // has a row in player_gameweek_stats for one of last 3 GWs
  teamId:                  number;
  position:                number;
}

// ── Eligibility levels ────────────────────────────────────────────────────────
//
// Different recommendation surfaces need different strictness.
//
//   STRICT     — for transfer targets (we're proposing a player to BUY). The
//                user spends money/free transfers, so the bar is high.
//   MODERATE   — for captaincy / lineup advice (player is already in the squad
//                but we don't want to suggest a benched / injured / probably-out
//                player as captain).
//   PERMISSIVE — for squad analysis (we still want to TALK about a player
//                even if they're injured, e.g. "your CB is out for 3 weeks").

export type EligibilityMode = 'STRICT' | 'MODERATE' | 'PERMISSIVE';

interface EligibilityThresholds {
  minMinutesLast3Gw:          number;
  minChanceOfPlayingNextRound:number;
  allowedStatuses:            Set<string>;
  requireRecentGw:            boolean;
}

const THRESHOLDS: Record<EligibilityMode, EligibilityThresholds> = {
  STRICT: {
    minMinutesLast3Gw:           90,           // must have at least one full match in last 3
    minChanceOfPlayingNextRound: 50,           // ≥ 50 % to play
    allowedStatuses:             new Set(['a']),
    requireRecentGw:             true,
  },
  MODERATE: {
    minMinutesLast3Gw:           30,
    minChanceOfPlayingNextRound: 25,
    allowedStatuses:             new Set(['a', 'd']),
    requireRecentGw:             true,
  },
  PERMISSIVE: {
    minMinutesLast3Gw:           0,
    minChanceOfPlayingNextRound: 0,
    allowedStatuses:             new Set(['a', 'd', 'i', 's', 'u']),
    requireRecentGw:             false,
  },
};

// ── Snapshot builder ──────────────────────────────────────────────────────────
//
// Builds the eligibility facts for a set of players in a single query. Call
// this once at the start of a recommendation cycle, then reuse the map.

export async function buildEligibilitySnapshots(
  playerIds: number[],
): Promise<Map<number, EligibilitySnapshot>> {
  if (!playerIds.length) return new Map();

  const liveGw = await getLiveGameweekId();
  const recentGws = [liveGw, liveGw - 1, liveGw - 2].filter((g) => g >= 1);

  // One query for the static facts.
  const players = await prisma.fplPlayer.findMany({
    where: { id: { in: playerIds } },
    select: {
      id:                       true,
      status:                   true,
      chanceOfPlayingNextRound: true,
      teamId:                   true,
      position:                 true,
    },
  });

  // One query for the recent-minutes aggregate.
  const recentStats = await prisma.playerGameweekStat.findMany({
    where: {
      playerId: { in: playerIds },
      gameweek: { in: recentGws },
    },
    select: { playerId: true, minutes: true, gameweek: true },
  });

  // Aggregate per player.
  const minutesByPlayer  = new Map<number, number>();
  const presenceByPlayer = new Map<number, Set<number>>();
  for (const row of recentStats) {
    minutesByPlayer.set(row.playerId, (minutesByPlayer.get(row.playerId) ?? 0) + row.minutes);
    if (!presenceByPlayer.has(row.playerId)) presenceByPlayer.set(row.playerId, new Set());
    presenceByPlayer.get(row.playerId)!.add(row.gameweek);
  }

  const out = new Map<number, EligibilitySnapshot>();
  for (const p of players) {
    out.set(p.id, {
      playerId:                 p.id,
      status:                   p.status,
      chanceOfPlayingNextRound: p.chanceOfPlayingNextRound,
      minutesLast3Gw:           minutesByPlayer.get(p.id) ?? 0,
      appearsInRecentGw:        (presenceByPlayer.get(p.id)?.size ?? 0) > 0,
      teamId:                   p.teamId,
      position:                 p.position,
    });
  }
  return out;
}

// ── Eligibility checker ──────────────────────────────────────────────────────

export function checkEligibility(
  snapshot: EligibilitySnapshot | undefined,
  mode:     EligibilityMode = 'STRICT',
): EligibilityResult {
  const reasons: string[] = [];
  const t = THRESHOLDS[mode];

  if (!snapshot) {
    return {
      eligible: false,
      reasons: ['No data available for this player — they may no longer be in the Premier League.'],
    };
  }

  // 1. Status check (the strongest "left the league" signal)
  if (!t.allowedStatuses.has(snapshot.status)) {
    const explain: Record<string, string> = {
      i: 'injured (status=i)',
      s: 'suspended (status=s)',
      u: 'unavailable / left the league (status=u)',
      d: 'doubtful (status=d)',
    };
    reasons.push(`Status flag: ${explain[snapshot.status] ?? snapshot.status}`);
  }

  // 2. Chance-of-playing check
  const chance = snapshot.chanceOfPlayingNextRound ?? 100;
  if (chance < t.minChanceOfPlayingNextRound) {
    reasons.push(`Only ${chance}% chance of playing next round`);
  }

  // 3. Recent-minutes check (the strongest "3rd-choice keeper / not-actually-playing" signal)
  if (snapshot.minutesLast3Gw < t.minMinutesLast3Gw) {
    reasons.push(
      `Only ${snapshot.minutesLast3Gw} minutes in the last 3 gameweeks ` +
      `(threshold for ${mode}: ${t.minMinutesLast3Gw})`,
    );
  }

  // 4. Recent presence check (the strongest "no longer in the league" signal)
  if (t.requireRecentGw && !snapshot.appearsInRecentGw) {
    reasons.push('No gameweek appearance in the last 3 GWs — likely not in the Premier League');
  }

  return { eligible: reasons.length === 0, reasons };
}

// ── Convenience helpers ──────────────────────────────────────────────────────

export function filterEligible<T extends { playerId: number }>(
  candidates:  T[],
  snapshots:   Map<number, EligibilitySnapshot>,
  mode:        EligibilityMode = 'STRICT',
): T[] {
  return candidates.filter(
    (c) => checkEligibility(snapshots.get(c.playerId), mode).eligible,
  );
}

export function partitionByEligibility<T extends { playerId: number }>(
  candidates: T[],
  snapshots:  Map<number, EligibilitySnapshot>,
  mode:       EligibilityMode = 'STRICT',
): { eligible: T[]; ineligible: Array<{ candidate: T; reasons: string[] }> } {
  const eligible: T[] = [];
  const ineligible: Array<{ candidate: T; reasons: string[] }> = [];

  for (const c of candidates) {
    const r = checkEligibility(snapshots.get(c.playerId), mode);
    if (r.eligible) eligible.push(c);
    else            ineligible.push({ candidate: c, reasons: r.reasons });
  }
  return { eligible, ineligible };
}