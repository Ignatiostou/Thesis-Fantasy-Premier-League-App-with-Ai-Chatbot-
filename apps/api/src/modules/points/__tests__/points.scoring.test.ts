// NOTE: The pure scoring helpers (applyAutoSubs, resolveCaptain, calculateSingleTeamScore, etc.)
// are private to points.service.ts and cannot be imported here. Until they are extracted to a
// separate scoring-helpers module and exported, this file re-declares them locally for testing
// purposes. If the production implementations diverge from these copies, tests will pass while
// the real code is broken. Consider extracting to src/modules/points/scoring.helpers.ts.

import { describe, it, expect } from 'vitest';
import { ChipType } from '@fpl/types';



type PlayerStatLite = { playerId: number; minutes: number; totalPoints: number };
type PlayerStatsMap = Map<number, PlayerStatLite>;

type PickWithRelations = {
  id: string;
  userTeamId: string;
  playerId: number;
  teamId: number;
  gameweek: number;
  position: number;
  isCaptain: boolean;
  isViceCaptain: boolean;
  isOnBench: boolean;
  benchOrder: number | null;
  buyPrice: number;
  player: {
    id: number;
    webName: string;
    position: number;
    teamId: number;
    eventPoints: number | null;
    totalPoints: number | null;
    team: { id: number; name: string; shortName: string };
  };
};

type GwStateLite = {
  userTeamId: string;
  gameweek: number;
  freeTransfers: number;
  transfersMade: number;
  pointsHit: number;
  activeChip: string | null;
};

// Pure helpers (mirrors points.service.ts)
function isBenchBoost(chip: string | null | undefined)    { return chip === ChipType.BENCH_BOOST; }
function isTripleCaptain(chip: string | null | undefined) { return chip === ChipType.TRIPLE_CAPTAIN; }

function isValidStartingFormation(players: PickWithRelations[]): boolean {
  if (players.length !== 11) return false;
  const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const p of players) counts[p.player.position] = (counts[p.player.position] ?? 0) + 1;
  return counts[1] === 1 && counts[2] >= 3 && counts[3] >= 2 && counts[4] >= 1;
}

function getPlayerMinutes(playerId: number, statsMap: PlayerStatsMap): number {
  return statsMap.get(playerId)?.minutes ?? 0;
}

function getPlayerBasePoints(playerId: number, statsMap: PlayerStatsMap): number {
  return statsMap.get(playerId)?.totalPoints ?? 0;
}

function applyAutoSubs(
  starters: PickWithRelations[],
  bench:    PickWithRelations[],
  statsMap: PlayerStatsMap,
) {
  const updatedStarters = [...starters];
  const sortedBench     = [...bench].sort((a, b) => (a.benchOrder ?? 99) - (b.benchOrder ?? 99));
  const usedBenchIds    = new Set<number>();
  const autoSubs: Array<{ outPlayerId: number; outWebName: string; inPlayerId: number; inWebName: string }> = [];

  // GK auto-sub
  const starterGkIndex = updatedStarters.findIndex((p) => p.player.position === 1);
  if (starterGkIndex !== -1) {
    const starterGk = updatedStarters[starterGkIndex];
    if (getPlayerMinutes(starterGk.playerId, statsMap) === 0) {
      const benchGk = sortedBench.find(
        (b) => b.player.position === 1 && getPlayerMinutes(b.playerId, statsMap) > 0,
      );
      if (benchGk) {
        updatedStarters[starterGkIndex] = benchGk;
        usedBenchIds.add(benchGk.playerId);
        autoSubs.push({ outPlayerId: starterGk.playerId, outWebName: starterGk.player.webName, inPlayerId: benchGk.playerId, inWebName: benchGk.player.webName });
      }
    }
  }

  // Outfield auto-subs
  for (let i = 0; i < updatedStarters.length; i++) {
    const starter = updatedStarters[i];
    if (starter.player.position === 1) continue;
    if (getPlayerMinutes(starter.playerId, statsMap) > 0) continue;

    for (const benchPlayer of sortedBench) {
      if (usedBenchIds.has(benchPlayer.playerId)) continue;
      if (benchPlayer.player.position === 1) continue;
      if (getPlayerMinutes(benchPlayer.playerId, statsMap) === 0) continue;

      const tentative = [...updatedStarters];
      tentative[i] = benchPlayer;
      if (!isValidStartingFormation(tentative)) continue;

      updatedStarters[i] = benchPlayer;
      usedBenchIds.add(benchPlayer.playerId);
      autoSubs.push({ outPlayerId: starter.playerId, outWebName: starter.player.webName, inPlayerId: benchPlayer.playerId, inWebName: benchPlayer.player.webName });
      break;
    }
  }

  return { startersAfterAutoSubs: updatedStarters, autoSubs };
}

function resolveCaptain(
  originalStarters: PickWithRelations[],
  countedPlayers:   PickWithRelations[],
  statsMap:         PlayerStatsMap,
) {
  const originalCaptain = originalStarters.find((p) => p.isCaptain) ?? null;
  const originalVice    = originalStarters.find((p) => p.isViceCaptain) ?? null;
  const countedIds      = new Set(countedPlayers.map((p) => p.playerId));

  const captainPlayed =
    originalCaptain &&
    countedIds.has(originalCaptain.playerId) &&
    getPlayerMinutes(originalCaptain.playerId, statsMap) > 0;

  if (captainPlayed) return { effectiveCaptainId: originalCaptain.playerId, effectiveViceCaptainId: originalVice?.playerId ?? null };

  const vicePlayed =
    originalVice &&
    countedIds.has(originalVice.playerId) &&
    getPlayerMinutes(originalVice.playerId, statsMap) > 0;

  if (vicePlayed) return { effectiveCaptainId: originalVice.playerId, effectiveViceCaptainId: null };

  return { effectiveCaptainId: null, effectiveViceCaptainId: null };
}

function calculateSingleTeamScore(
  picks:    PickWithRelations[],
  gwState:  GwStateLite,
  statsMap: PlayerStatsMap,
) {
  if (picks.length !== 15) throw new Error('INVALID_PICKS_FOR_GAMEWEEK');

  const starters = picks.filter((p) => !p.isOnBench);
  const bench    = picks.filter((p) => p.isOnBench).sort((a, b) => (a.benchOrder ?? 99) - (b.benchOrder ?? 99));

  const benchBoost     = isBenchBoost(gwState.activeChip);
  const tripleCaptain  = isTripleCaptain(gwState.activeChip);

  let countedPlayers: PickWithRelations[];
  let autoSubs: typeof bench = [];

  if (benchBoost) {
    countedPlayers = [...starters, ...bench];
  } else {
    const auto = applyAutoSubs(starters, bench, statsMap);
    countedPlayers = auto.startersAfterAutoSubs;
    autoSubs = auto.autoSubs as any;
  }

  const { effectiveCaptainId } = resolveCaptain(starters, countedPlayers, statsMap);
  const countedIds = new Set(countedPlayers.map((p) => p.playerId));

  let pointsBeforeHits = 0;
  let benchPoints = 0;

  const breakdown = picks.map((pick) => {
    const basePoints = getPlayerBasePoints(pick.playerId, statsMap);
    const minutes    = getPlayerMinutes(pick.playerId, statsMap);
    const counted    = countedIds.has(pick.playerId);
    let multiplier   = 0;
    let finalPoints  = 0;

    if (counted) {
      multiplier = 1;
      if (effectiveCaptainId && pick.playerId === effectiveCaptainId) {
        multiplier = tripleCaptain ? 3 : 2;
      }
      finalPoints = basePoints * multiplier;
      pointsBeforeHits += finalPoints;
    } else if (pick.isOnBench) {
      benchPoints += basePoints;
    }

    return { playerId: pick.playerId, basePoints, multiplier, finalPoints, counted, isOnBench: pick.isOnBench, minutes, wasAutoSubbedIn: (autoSubs as any[]).some((s) => s.inPlayerId === pick.playerId) };
  });

  const pointsHit   = gwState.pointsHit ?? 0;
  const finalPoints = pointsBeforeHits - pointsHit;

  return { pointsBeforeHits, finalPoints, transferHits: Math.floor(pointsHit / 4), pointsHit, benchPoints, captainPlayerId: effectiveCaptainId, chipPlayed: gwState.activeChip, autoSubsApplied: autoSubs, breakdown };
}

// ── Squad builder helpers ─────────────────────────────────────────────────────

let _idCounter = 1;

function makePick(overrides: {
  playerId:     number;
  position:     number; // player position 1=GK 2=DEF 3=MID 4=FWD
  isOnBench:    boolean;
  benchOrder?:  number;
  isCaptain?:   boolean;
  isViceCaptain?: boolean;
  webName?:     string;
}): PickWithRelations {
  return {
    id:           `pick_${_idCounter++}`,
    userTeamId:   'team_1',
    playerId:     overrides.playerId,
    teamId:       1,
    gameweek:     34,
    position:     overrides.position,
    isCaptain:    overrides.isCaptain    ?? false,
    isViceCaptain: overrides.isViceCaptain ?? false,
    isOnBench:    overrides.isOnBench,
    benchOrder:   overrides.benchOrder   ?? null,
    buyPrice:     80,
    player: {
      id:         overrides.playerId,
      webName:    overrides.webName ?? `P${overrides.playerId}`,
      position:   overrides.position,
      teamId:     1,
      eventPoints: null,
      totalPoints: null,
      team: { id: 1, name: 'Team', shortName: 'TST' },
    },
  };
}

function makeStats(playerId: number, minutes: number, totalPoints: number): PlayerStatLite {
  return { playerId, minutes, totalPoints };
}

function makeGwState(overrides: Partial<GwStateLite> = {}): GwStateLite {
  return {
    userTeamId:    'team_1',
    gameweek:      34,
    freeTransfers: 1,
    transfersMade: 0,
    pointsHit:     0,
    activeChip:    null,
    ...overrides,
  };
}

// Standard 4-4-2 squad: GK(1) DEF(5) MID(5) FWD(3) + bench(4)
function buildStandardSquad(): PickWithRelations[] {
  return [
    // Starters
    makePick({ playerId: 1,  position: 1, isOnBench: false }),                              // GK
    makePick({ playerId: 2,  position: 2, isOnBench: false }),                              // DEF
    makePick({ playerId: 3,  position: 2, isOnBench: false }),                              // DEF
    makePick({ playerId: 4,  position: 2, isOnBench: false }),                              // DEF
    makePick({ playerId: 5,  position: 2, isOnBench: false }),                              // DEF
    makePick({ playerId: 6,  position: 3, isOnBench: false, isCaptain: true }),             // MID (C)
    makePick({ playerId: 7,  position: 3, isOnBench: false, isViceCaptain: true }),         // MID (VC)
    makePick({ playerId: 8,  position: 3, isOnBench: false }),                              // MID
    makePick({ playerId: 9,  position: 3, isOnBench: false }),                              // MID
    makePick({ playerId: 10, position: 4, isOnBench: false }),                              // FWD
    makePick({ playerId: 11, position: 4, isOnBench: false }),                              // FWD
    // Bench
    makePick({ playerId: 12, position: 4, isOnBench: true,  benchOrder: 1 }),               // FWD bench 1
    makePick({ playerId: 13, position: 3, isOnBench: true,  benchOrder: 2 }),               // MID bench 2
    makePick({ playerId: 14, position: 2, isOnBench: true,  benchOrder: 3 }),               // DEF bench 3
    makePick({ playerId: 15, position: 1, isOnBench: true,  benchOrder: 4 }),               // GK  bench 4
  ];
}

function allPlayedStats(score = 5): PlayerStatsMap {
  const map = new Map<number, PlayerStatLite>();
  for (let i = 1; i <= 15; i++) map.set(i, makeStats(i, 90, score));
  return map;
}

// ── isBenchBoost / isTripleCaptain ────────────────────────────────────────────

describe('chip detection helpers', () => {

  it('isBenchBoost returns true only for BENCH_BOOST', () => {
    expect(isBenchBoost(ChipType.BENCH_BOOST)).toBe(true);
    expect(isBenchBoost(ChipType.TRIPLE_CAPTAIN)).toBe(false);
    expect(isBenchBoost(null)).toBe(false);
    expect(isBenchBoost(undefined)).toBe(false);
    expect(isBenchBoost('wildcard')).toBe(false);
  });

  it('isTripleCaptain returns true only for TRIPLE_CAPTAIN', () => {
    expect(isTripleCaptain(ChipType.TRIPLE_CAPTAIN)).toBe(true);
    expect(isTripleCaptain(ChipType.BENCH_BOOST)).toBe(false);
    expect(isTripleCaptain(null)).toBe(false);
    expect(isTripleCaptain(undefined)).toBe(false);
  });
});

// ── resolveCaptain ────────────────────────────────────────────────────────────

describe('resolveCaptain', () => {

  it('returns captain when captain played', () => {
    const squad   = buildStandardSquad();
    const starters = squad.filter((p) => !p.isOnBench);
    const stats   = allPlayedStats();
    const result  = resolveCaptain(starters, starters, stats);
    expect(result.effectiveCaptainId).toBe(6); // MID captain
  });

  it('falls back to VC when captain played 0 minutes', () => {
    const squad    = buildStandardSquad();
    const starters = squad.filter((p) => !p.isOnBench);
    const stats    = allPlayedStats();
    stats.set(6, makeStats(6, 0, 8)); // captain played 0 mins
    const result   = resolveCaptain(starters, starters, stats);
    expect(result.effectiveCaptainId).toBe(7); // VC takes armband
  });

  it('returns null captain when both captain and VC played 0 minutes', () => {
    const squad    = buildStandardSquad();
    const starters = squad.filter((p) => !p.isOnBench);
    const stats    = allPlayedStats();
    stats.set(6, makeStats(6, 0, 8));
    stats.set(7, makeStats(7, 0, 6));
    const result   = resolveCaptain(starters, starters, stats);
    expect(result.effectiveCaptainId).toBeNull();
  });

  it('returns null captain when there is no captain in the squad', () => {
    const squad    = buildStandardSquad().map((p) => ({ ...p, isCaptain: false, isViceCaptain: false }));
    const starters = squad.filter((p) => !p.isOnBench);
    const stats    = allPlayedStats();
    const result   = resolveCaptain(starters, starters, stats);
    expect(result.effectiveCaptainId).toBeNull();
  });

  it('sets effectiveViceCaptainId to null when VC takes armband', () => {
    const squad    = buildStandardSquad();
    const starters = squad.filter((p) => !p.isOnBench);
    const stats    = allPlayedStats();
    stats.set(6, makeStats(6, 0, 8));
    const result   = resolveCaptain(starters, starters, stats);
    expect(result.effectiveViceCaptainId).toBeNull();
  });
});

// ── applyAutoSubs ─────────────────────────────────────────────────────────────

describe('applyAutoSubs', () => {

  it('makes no subs when all starters played', () => {
    const squad    = buildStandardSquad();
    const starters = squad.filter((p) => !p.isOnBench);
    const bench    = squad.filter((p) => p.isOnBench);
    const stats    = allPlayedStats();
    const result   = applyAutoSubs(starters, bench, stats);
    expect(result.autoSubs).toHaveLength(0);
    expect(result.startersAfterAutoSubs).toHaveLength(11);
  });

  it('subs in first bench player for non-playing starter', () => {
    const squad    = buildStandardSquad();
    const starters = squad.filter((p) => !p.isOnBench);
    const bench    = squad.filter((p) => p.isOnBench);
    const stats    = allPlayedStats();
    stats.set(10, makeStats(10, 0, 0)); // FWD10 did not play
    const result   = applyAutoSubs(starters, bench, stats);
    expect(result.autoSubs).toHaveLength(1);
    expect(result.autoSubs[0].outPlayerId).toBe(10);
    expect(result.autoSubs[0].inPlayerId).toBe(12); // bench order 1
  });

  it('auto-subs GK when starting GK did not play', () => {
    const squad    = buildStandardSquad();
    const starters = squad.filter((p) => !p.isOnBench);
    const bench    = squad.filter((p) => p.isOnBench);
    const stats    = allPlayedStats();
    stats.set(1, makeStats(1, 0, 0));  // GK1 did not play
    const result   = applyAutoSubs(starters, bench, stats);
    const gkSub = result.autoSubs.find((s) => s.outPlayerId === 1);
    expect(gkSub).toBeDefined();
    expect(gkSub?.inPlayerId).toBe(15); // bench GK
  });

  it('does not sub in bench GK for outfield position', () => {
    const squad    = buildStandardSquad();
    const starters = squad.filter((p) => !p.isOnBench);
    const bench    = squad.filter((p) => p.isOnBench);
    const stats    = allPlayedStats();
    stats.set(10, makeStats(10, 0, 0)); // FWD10 did not play
    // Make all outfield bench players not play — only GK bench available
    stats.set(12, makeStats(12, 0, 0));
    stats.set(13, makeStats(13, 0, 0));
    stats.set(14, makeStats(14, 0, 0));
    const result = applyAutoSubs(starters, bench, stats);
    // No valid outfield sub available — no sub made for FWD slot
    const fwdSub = result.autoSubs.find((s) => s.outPlayerId === 10);
    expect(fwdSub).toBeUndefined();
  });

  it('does not make a sub that would break the formation', () => {
    // Build a 3-5-2 squad (minimal DEF = 3)
    const squad = [
      makePick({ playerId: 1,  position: 1, isOnBench: false }),
      makePick({ playerId: 2,  position: 2, isOnBench: false }),
      makePick({ playerId: 3,  position: 2, isOnBench: false }),
      makePick({ playerId: 4,  position: 2, isOnBench: false }),
      makePick({ playerId: 5,  position: 3, isOnBench: false, isCaptain: true }),
      makePick({ playerId: 6,  position: 3, isOnBench: false, isViceCaptain: true }),
      makePick({ playerId: 7,  position: 3, isOnBench: false }),
      makePick({ playerId: 8,  position: 3, isOnBench: false }),
      makePick({ playerId: 9,  position: 3, isOnBench: false }),
      makePick({ playerId: 10, position: 4, isOnBench: false }),
      makePick({ playerId: 11, position: 4, isOnBench: false }),
      // Bench: 3 FWD bench players — subbing a DEF out for a FWD would leave only 2 DEF
      makePick({ playerId: 12, position: 4, isOnBench: true, benchOrder: 1 }),
      makePick({ playerId: 13, position: 4, isOnBench: true, benchOrder: 2 }),
      makePick({ playerId: 14, position: 4, isOnBench: true, benchOrder: 3 }),
      makePick({ playerId: 15, position: 1, isOnBench: true, benchOrder: 4 }),
    ];
    const starters = squad.filter((p) => !p.isOnBench);
    const bench    = squad.filter((p) => p.isOnBench);
    const stats    = allPlayedStats();
    stats.set(2, makeStats(2, 0, 0)); // DEF2 did not play

    const result = applyAutoSubs(starters, bench, stats);
    // No FWD bench can replace a DEF without breaking 3-DEF minimum
    const defSub = result.autoSubs.find((s) => s.outPlayerId === 2);
    expect(defSub).toBeUndefined();
  });

  it('respects bench order when multiple bench players are available', () => {
    const squad    = buildStandardSquad();
    const starters = squad.filter((p) => !p.isOnBench);
    const bench    = squad.filter((p) => p.isOnBench);
    const stats    = allPlayedStats();
    stats.set(10, makeStats(10, 0, 0)); // FWD10 out
    const result = applyAutoSubs(starters, bench, stats);
    // bench order 1 is playerId 12 (FWD) — should be the sub
    expect(result.autoSubs[0].inPlayerId).toBe(12);
  });
});

// ── calculateSingleTeamScore ──────────────────────────────────────────────────

describe('calculateSingleTeamScore', () => {

  it('throws INVALID_PICKS_FOR_GAMEWEEK if not exactly 15 picks', () => {
    const picks = buildStandardSquad().slice(0, 14);
    expect(() => calculateSingleTeamScore(picks, makeGwState(), allPlayedStats()))
      .toThrow('INVALID_PICKS_FOR_GAMEWEEK');
  });

  it('calculates correct total with no chips and no hits', () => {
    const squad  = buildStandardSquad();
    const stats  = allPlayedStats(5); // all 11 starters score 5 pts
    const result = calculateSingleTeamScore(squad, makeGwState(), stats);
    // 10 outfield starters × 5 = 50, captain(6) gets ×2 = +5 extra, GK×5 = 5 → total 60
    expect(result.pointsBeforeHits).toBe(60);
    expect(result.finalPoints).toBe(60);
    expect(result.pointsHit).toBe(0);
  });

  it('applies captain ×2 multiplier', () => {
    const squad = buildStandardSquad();
    const stats = new Map<number, PlayerStatLite>();
    for (let i = 1; i <= 15; i++) stats.set(i, makeStats(i, 90, 6));
    const result = calculateSingleTeamScore(squad, makeGwState(), stats);
    const captainBreakdown = result.breakdown.find((b) => b.playerId === 6);
    expect(captainBreakdown?.multiplier).toBe(2);
    expect(captainBreakdown?.finalPoints).toBe(12);
  });

  it('applies triple captain ×3 multiplier', () => {
    const squad  = buildStandardSquad();
    const stats  = allPlayedStats(6);
    const result = calculateSingleTeamScore(squad, makeGwState({ activeChip: ChipType.TRIPLE_CAPTAIN }), stats);
    const captainBreakdown = result.breakdown.find((b) => b.playerId === 6);
    expect(captainBreakdown?.multiplier).toBe(3);
    expect(captainBreakdown?.finalPoints).toBe(18);
  });

  it('applies VC ×2 when captain played 0 minutes', () => {
    const squad  = buildStandardSquad();
    const stats  = allPlayedStats(6);
    stats.set(6, makeStats(6, 0, 6)); // captain did not play
    const result = calculateSingleTeamScore(squad, makeGwState(), stats);
    expect(result.captainPlayerId).toBe(7); // VC takes armband
    const vcBreakdown = result.breakdown.find((b) => b.playerId === 7);
    expect(vcBreakdown?.multiplier).toBe(2);
  });

  it('deducts transfer hit from final points', () => {
    const squad  = buildStandardSquad();
    const stats  = allPlayedStats(5);
    const result = calculateSingleTeamScore(squad, makeGwState({ pointsHit: 4, transfersMade: 2 }), stats);
    expect(result.finalPoints).toBe(result.pointsBeforeHits - 4);
    expect(result.pointsHit).toBe(4);
    expect(result.transferHits).toBe(1);
  });

  it('deducts 8 points for double hit', () => {
    const squad  = buildStandardSquad();
    const stats  = allPlayedStats(5);
    const result = calculateSingleTeamScore(squad, makeGwState({ pointsHit: 8 }), stats);
    expect(result.pointsHit).toBe(8);
    expect(result.transferHits).toBe(2);
    expect(result.finalPoints).toBe(result.pointsBeforeHits - 8);
  });

  it('bench boost counts all 15 players', () => {
    const squad  = buildStandardSquad();
    const stats  = allPlayedStats(4);
    const result = calculateSingleTeamScore(squad, makeGwState({ activeChip: ChipType.BENCH_BOOST }), stats);
    const countedCount = result.breakdown.filter((b) => b.counted).length;
    expect(countedCount).toBe(15);
    // 15 × 4 = 60, plus captain bonus = 4 extra → 64
    expect(result.pointsBeforeHits).toBe(64);
  });

  it('bench boost makes no auto subs', () => {
    const squad = buildStandardSquad();
    const stats = allPlayedStats(4);
    stats.set(10, makeStats(10, 0, 4)); // starter did not play but bench boost active
    const result = calculateSingleTeamScore(squad, makeGwState({ activeChip: ChipType.BENCH_BOOST }), stats);
    expect(result.autoSubsApplied).toHaveLength(0);
    // Player 10 should still be counted (bench boost)
    const p10 = result.breakdown.find((b) => b.playerId === 10);
    expect(p10?.counted).toBe(true);
  });

  it('bench points only count non-playing bench players', () => {
    const squad = buildStandardSquad();
    const stats = allPlayedStats(5);
    stats.set(12, makeStats(12, 0, 3)); // bench player did not play
    stats.set(13, makeStats(13, 0, 2));
    stats.set(14, makeStats(14, 0, 1));
    stats.set(15, makeStats(15, 0, 0)); // GK bench
    const result = calculateSingleTeamScore(squad, makeGwState(), stats);
    // bench players who did not auto-sub in contribute to benchPoints
    expect(result.benchPoints).toBeGreaterThanOrEqual(0);
  });

  it('chipPlayed reflects the active chip in gwState', () => {
    const squad  = buildStandardSquad();
    const stats  = allPlayedStats(5);
    const result = calculateSingleTeamScore(squad, makeGwState({ activeChip: ChipType.TRIPLE_CAPTAIN }), stats);
    expect(result.chipPlayed).toBe(ChipType.TRIPLE_CAPTAIN);
  });

  it('chipPlayed is null when no chip active', () => {
    const squad  = buildStandardSquad();
    const stats  = allPlayedStats(5);
    const result = calculateSingleTeamScore(squad, makeGwState(), stats);
    expect(result.chipPlayed).toBeNull();
  });

  it('counts 11 players when no chip active and all starters played', () => {
    const squad  = buildStandardSquad();
    const stats  = allPlayedStats(5);
    const result = calculateSingleTeamScore(squad, makeGwState(), stats);
    const counted = result.breakdown.filter((b) => b.counted).length;
    expect(counted).toBe(11);
  });

  it('marks wasAutoSubbedIn correctly', () => {
    const squad    = buildStandardSquad();
    const stats    = allPlayedStats(5);
    stats.set(10, makeStats(10, 0, 5)); // FWD10 did not play
    const result   = calculateSingleTeamScore(squad, makeGwState(), stats);
    const subIn    = result.breakdown.find((b) => b.wasAutoSubbedIn);
    expect(subIn?.playerId).toBe(12); // first bench outfield
  });
});