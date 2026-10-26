import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db/prisma.js', () => ({
  prisma: {
    userTeam: { findUnique: vi.fn() },
  },
}));

vi.mock('../../../utils/gameweek.js', () => ({
  getEditableGameweekId: vi.fn().mockResolvedValue(34),
}));

vi.mock('../player-search.service.js', () => ({
  findMentionedPlayersDetailed: vi.fn(),
}));

// evaluateMentionedTransfer does its own STRICT eligibility re-check on the
// incoming player (on top of whatever findMentionedPlayersDetailed already
// filtered) — mock it out so these tests exercise transfer-evaluator's own
// logic, not player-eligibility's DB queries. Defaults to "eligible" so
// existing tests (none of which target this recheck specifically) are
// unaffected; buildEligibilitySnapshots' Map lookup just needs a defined Map.
vi.mock('../player-eligibility.service.js', () => ({
  buildEligibilitySnapshots: vi.fn().mockResolvedValue(new Map()),
  checkEligibility: vi.fn().mockReturnValue({ eligible: true, reasons: [] }),
}));

import { prisma } from '../../../db/prisma.js';
import { findMentionedPlayersDetailed } from '../player-search.service.js';
import { evaluateMentionedTransfer } from '../transfer-evaluator.service.js';

const mock = prisma as any;

function mockFound(players: any[]) {
  vi.mocked(findMentionedPlayersDetailed).mockResolvedValue({ players, excluded: [] });
}

function makeTeamWithPicks(budget = 50, picks: any[] = []) {
  return { id: 'team_1', budget, picks };
}

function makePick(playerId: number, teamId: number, buyPrice: number) {
  return {
    playerId, buyPrice,
    player: {
      id: playerId,
      teamId,
      team: {
        id: teamId,
        name: 'Test Team',
        shortName: 'TST',
        code: null,
      },
    },
  };
}

function makePlayer(id: number, overrides: any = {}) {
  return {
    id,
    webName:                  overrides.webName   ?? `P${id}`,
    firstName:                overrides.firstName ?? `First${id}`,
    secondName:               overrides.secondName ?? `Last${id}`,
    nowCost:                  overrides.nowCost   ?? 80,
    position:                 overrides.position  ?? 3,
    teamId:                   overrides.teamId    ?? id + 10,
    totalPoints:              overrides.totalPoints ?? 60,
    eventPoints:              overrides.eventPoints ?? 0,
    minutes:                  overrides.minutes   ?? 1000,
    goalsScored:              overrides.goalsScored ?? 2,
    assists:                  overrides.assists   ?? 1,
    cleanSheets:              overrides.cleanSheets ?? 0,
    bonus:                    overrides.bonus     ?? 5,
    selectedByPercent:        overrides.selectedByPercent ?? 50,
    form:                     overrides.form      ?? 5.5,
    raw:                      overrides.raw       ?? null,
    chanceOfPlayingNextRound: overrides.chance    ?? 100,
    status:                   overrides.status    ?? 'a',
    team: {
      id: overrides.teamId ?? id + 10,
      name: overrides.teamName ?? 'Test Team',
      shortName: overrides.shortName ?? 'TST',
      code: overrides.teamCode ?? null,
    },
  };
}

// Standard picks: player 1 in squad (teamId 10), others from different clubs
const SQUAD = [makePick(1, 10, 75), makePick(3, 11, 60), makePick(4, 12, 55)];

describe('evaluateMentionedTransfer', () => {

  beforeEach(() => vi.clearAllMocks());

  // ── No team ─────────────────────────────────────────────────────────────────

  it('returns detected:false when user has no team', async () => {
    mock.userTeam.findUnique.mockResolvedValue(null);
    mockFound([]);
    const result = await evaluateMentionedTransfer('user_1', 'transfer');
    expect(result.detected).toBe(false);
    expect(result.recommendation).toContain('No team found');
  });

  // ── No players detected ──────────────────────────────────────────────────────

  it('returns detected:false when no players found in message', async () => {
    mock.userTeam.findUnique.mockResolvedValue(makeTeamWithPicks(50, SQUAD));
    mockFound([]);
    const result = await evaluateMentionedTransfer('user_1', 'what transfers should i make');
    expect(result.detected).toBe(false);
    expect(result.recommendation).toContain('could not confidently detect');
  });

  it('returns detected:false when both mentioned players are in the squad', async () => {
    mock.userTeam.findUnique.mockResolvedValue(makeTeamWithPicks(50, SQUAD));
    mockFound([makePlayer(1), makePlayer(3)]);
    const result = await evaluateMentionedTransfer('user_1', 'p1 vs p3');
    expect(result.detected).toBe(false);
  });

  it('returns detected:false when both mentioned players are NOT in squad', async () => {
    mock.userTeam.findUnique.mockResolvedValue(makeTeamWithPicks(50, SQUAD));
    mockFound([makePlayer(99), makePlayer(98)]);
    const result = await evaluateMentionedTransfer('user_1', 'p99 for p98');
    expect(result.detected).toBe(false);
  });

  // ── Valid transfer detection ──────────────────────────────────────────────────

  it('correctly identifies outgoing (in squad) and incoming (not in squad)', async () => {
    mock.userTeam.findUnique.mockResolvedValue(makeTeamWithPicks(50, SQUAD));
    mockFound([makePlayer(1), makePlayer(99)]);
    const result = await evaluateMentionedTransfer('user_1', 'transfer p1 for p99');
    expect(result.detected).toBe(true);
    expect(result.outgoingPlayer?.playerId).toBe(1);
    expect(result.incomingPlayer?.playerId).toBe(99);
  });

  // ── Sell price ────────────────────────────────────────────────────────────────

  it('calculates sell price correctly when price has not risen', async () => {
    mock.userTeam.findUnique.mockResolvedValue(makeTeamWithPicks(50, [makePick(1, 10, 75)]));
    mockFound([makePlayer(1, { nowCost: 70 }), makePlayer(99)]);
    const result = await evaluateMentionedTransfer('user_1', 'transfer');
    expect(result.outgoingPlayer?.sellPrice).toBe(70);
  });

  it('gives half profit on price rise (buy 75 → now 79 → sell 77)', async () => {
    mock.userTeam.findUnique.mockResolvedValue(makeTeamWithPicks(50, [makePick(1, 10, 75)]));
    mockFound([makePlayer(1, { nowCost: 79 }), makePlayer(99, { nowCost: 80 })]);
    const result = await evaluateMentionedTransfer('user_1', 'transfer');
    expect(result.outgoingPlayer?.sellPrice).toBe(77);
  });

  it('floors profit on odd rise (buy 75 → now 78 → sell 76)', async () => {
    mock.userTeam.findUnique.mockResolvedValue(makeTeamWithPicks(50, [makePick(1, 10, 75)]));
    mockFound([makePlayer(1, { nowCost: 78 }), makePlayer(99, { nowCost: 80 })]);
    const result = await evaluateMentionedTransfer('user_1', 'transfer');
    expect(result.outgoingPlayer?.sellPrice).toBe(76);
  });

  // ── Budget impact ─────────────────────────────────────────────────────────────

  it('marks transfer as affordable when bank covers cost', async () => {
    // bank=50, sell=75 (no rise), buy=100 → bankAfter = 50+75-100 = 25
    mock.userTeam.findUnique.mockResolvedValue(makeTeamWithPicks(50, [makePick(1, 10, 75)]));
    mockFound([makePlayer(1, { nowCost: 75 }), makePlayer(99, { nowCost: 100 })]);
    const result = await evaluateMentionedTransfer('user_1', 'transfer');
    expect(result.budgetImpact?.affordable).toBe(true);
    expect(result.budgetImpact?.bankAfter).toBe(25);
  });

  it('marks transfer as NOT affordable when cost exceeds bank', async () => {
    // bank=10, sell=75, buy=100 → bankAfter = -15
    mock.userTeam.findUnique.mockResolvedValue(makeTeamWithPicks(10, [makePick(1, 10, 75)]));
    mockFound([makePlayer(1, { nowCost: 75 }), makePlayer(99, { nowCost: 100 })]);
    const result = await evaluateMentionedTransfer('user_1', 'transfer');
    expect(result.budgetImpact?.affordable).toBe(false);
    expect(result.risks).toContain('not affordable with current bank');
  });

  // ── Position mismatch ─────────────────────────────────────────────────────────

  it('flags position mismatch in risks', async () => {
    mock.userTeam.findUnique.mockResolvedValue(makeTeamWithPicks(50, [makePick(1, 10, 75)]));
    mockFound([
      makePlayer(1, { position: 3, nowCost: 75 }),
      makePlayer(99, { position: 4, nowCost: 75 }), // FWD not MID
    ]);
    const result = await evaluateMentionedTransfer('user_1', 'transfer');
    expect(result.ruleCheck?.samePosition).toBe(false);
    expect(result.risks).toContain('position mismatch');
  });

  it('passes position check when positions match', async () => {
    mock.userTeam.findUnique.mockResolvedValue(makeTeamWithPicks(50, [makePick(1, 10, 75)]));
    mockFound([
      makePlayer(1, { position: 3, nowCost: 75 }),
      makePlayer(99, { position: 3, nowCost: 75 }),
    ]);
    const result = await evaluateMentionedTransfer('user_1', 'transfer');
    expect(result.ruleCheck?.samePosition).toBe(true);
  });

  // ── Club limit ────────────────────────────────────────────────────────────────
  // Fix: need 4 picks from same club AFTER swap to trigger the limit.
  // Squad has 4 picks where player 1 is being swapped OUT (teamId=10) and
  // 3 OTHER players are also from teamId=10. After swap: 3 (staying) + 1 (incoming) = 4.

  it('flags club limit breach when incoming player takes club to 4', async () => {
  // Player 1 goes OUT from teamId 10.
  // Players 2, 3, 4 stay from teamId 10.
  // Incoming player 99 is also from teamId 10.
  // After transfer: 3 staying + 1 incoming = 4 → breach.

  const picks = [
    makePick(1, 10, 75), // OUT
    makePick(2, 10, 70), // staying
    makePick(3, 10, 65), // staying
    makePick(4, 10, 60), // staying
  ];

  mock.userTeam.findUnique.mockResolvedValue(makeTeamWithPicks(100, picks));

  mockFound([
    makePlayer(1, { teamId: 10, nowCost: 75 }),
    makePlayer(99, { teamId: 10, nowCost: 75 }),
  ]);

  const result = await evaluateMentionedTransfer('user_1', 'transfer');

  expect(result.ruleCheck?.maxPerClubLikelyOk).toBe(false);
  expect(result.risks).toContain('likely breaks max 3 players per club');
});

  // ── Availability risk ─────────────────────────────────────────────────────────

  it('flags availability risk when incoming player has < 75% chance', async () => {
    mock.userTeam.findUnique.mockResolvedValue(makeTeamWithPicks(50, [makePick(1, 10, 75)]));
    mockFound([
      makePlayer(1, { nowCost: 75 }),
      makePlayer(99, { nowCost: 75, chance: 50 }),
    ]);
    const result = await evaluateMentionedTransfer('user_1', 'transfer');
    expect(result.risks?.some((r) => r.includes('availability'))).toBe(true);
  });

  it('flags status risk when incoming player is not available', async () => {
    mock.userTeam.findUnique.mockResolvedValue(makeTeamWithPicks(50, [makePick(1, 10, 75)]));
    mockFound([
      makePlayer(1, { nowCost: 75 }),
      makePlayer(99, { nowCost: 75, status: 'd' }),
    ]);
    const result = await evaluateMentionedTransfer('user_1', 'transfer');
    expect(result.risks?.some((r) => r.includes('status flag'))).toBe(true);
  });

  // ── Recommendation text ───────────────────────────────────────────────────────

  it('returns positive recommendation for valid affordable same-position transfer', async () => {
    mock.userTeam.findUnique.mockResolvedValue(makeTeamWithPicks(50, [makePick(1, 10, 75)]));
    mockFound([
      makePlayer(1, { position: 3, nowCost: 75 }),
      makePlayer(99, { position: 3, nowCost: 80 }),
    ]);
    const result = await evaluateMentionedTransfer('user_1', 'transfer');
    expect(result.recommendation).toContain('technically valid');
  });

  it('returns cautious recommendation when transfer has structural issues', async () => {
    mock.userTeam.findUnique.mockResolvedValue(makeTeamWithPicks(5, [makePick(1, 10, 75)]));
    mockFound([
      makePlayer(1, { position: 3, nowCost: 75 }),
      makePlayer(99, { position: 4, nowCost: 100 }), // wrong pos + unaffordable
    ]);
    const result = await evaluateMentionedTransfer('user_1', 'transfer');
    expect(result.recommendation).toContain('structural issues');
  });
});
