import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/prisma.js', () => ({
  prisma: {
    userTeam: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    fplPlayer: { findMany: vi.fn() },
    userPick: {
      findMany: vi.fn(),
      update: vi.fn(),
      createMany: vi.fn(),
    },
    userGameweekState: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    userGameweekScore: { aggregate: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('../../utils/gameweek.js', () => ({
  getEditableGameweekId: vi.fn().mockResolvedValue(34),
  ensureUserTeamPicksForGameweek: vi.fn().mockResolvedValue(undefined),
}));

import { initializeSquad, updateLineup, getMyTeam } from './team.service.js';
import { prisma } from '../../db/prisma.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function makePlayer(id: number, position: number, teamId = 1, nowCost = 50, points = 100) {
  return {
    id,
    position,
    teamId,
    nowCost,
    totalPoints: points,
    webName: `Player${id}`,
    team: { id: teamId, name: `Team${teamId}`, shortName: `T${teamId}` },
  };
}

// 15 valid players: 2 GK, 5 DEF, 5 MID, 3 FWD, all different clubs, total cost 750
function validSquad() {
  return [
    makePlayer(1, 1, 1),  // GK
    makePlayer(2, 1, 2),  // GK
    makePlayer(3, 2, 3),  // DEF
    makePlayer(4, 2, 4),  // DEF
    makePlayer(5, 2, 5),  // DEF
    makePlayer(6, 2, 6),  // DEF
    makePlayer(7, 2, 7),  // DEF
    makePlayer(8, 3, 8),  // MID
    makePlayer(9, 3, 9),  // MID
    makePlayer(10, 3, 10), // MID
    makePlayer(11, 3, 11), // MID
    makePlayer(12, 3, 12), // MID
    makePlayer(13, 4, 13), // FWD
    makePlayer(14, 4, 14), // FWD
    makePlayer(15, 4, 15), // FWD
  ];
}

function makePick(playerId: number, position: number, isOnBench: boolean, player: any) {
  return {
    id: `pick-${playerId}`,
    playerId,
    position,
    isOnBench,
    benchOrder: isOnBench ? position - 11 : null,
    isCaptain: position === 1,
    isViceCaptain: position === 2,
    buyPrice: player.nowCost,
    player,
  };
}

beforeEach(() => vi.clearAllMocks());

// ── initializeSquad ───────────────────────────────────────────────────────────

describe('initializeSquad', () => {
  it('throws TEAM_ALREADY_EXISTS if the user already has a team', async () => {
    vi.mocked(prisma.userTeam.findUnique).mockResolvedValue({ id: 'team-1' } as any);

    await expect(initializeSquad('user-1', Array.from({ length: 15 }, (_, i) => i + 1)))
      .rejects.toThrow('TEAM_ALREADY_EXISTS');
  });

  it('throws INVALID_DUPLICATE_PLAYERS if fewer than 15 unique IDs are given', async () => {
    vi.mocked(prisma.userTeam.findUnique).mockResolvedValue(null);

    // 14 unique IDs
    await expect(initializeSquad('user-1', Array.from({ length: 14 }, (_, i) => i + 1)))
      .rejects.toThrow('INVALID_DUPLICATE_PLAYERS');
  });

  it('throws INVALID_DUPLICATE_PLAYERS when duplicate IDs are passed', async () => {
    vi.mocked(prisma.userTeam.findUnique).mockResolvedValue(null);

    // 15 IDs but with duplicates → only 14 unique
    const ids = [...Array.from({ length: 14 }, (_, i) => i + 1), 1];
    await expect(initializeSquad('user-1', ids))
      .rejects.toThrow('INVALID_DUPLICATE_PLAYERS');
  });

  it('throws INVALID_PLAYERS_NOT_FOUND when DB returns fewer players than expected', async () => {
    vi.mocked(prisma.userTeam.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.fplPlayer.findMany).mockResolvedValue(
      validSquad().slice(0, 14) as any, // only 14 returned
    );

    await expect(initializeSquad('user-1', Array.from({ length: 15 }, (_, i) => i + 1)))
      .rejects.toThrow('INVALID_PLAYERS_NOT_FOUND');
  });

  it('throws INVALID_GK_COUNT when squad has wrong number of goalkeepers', async () => {
    vi.mocked(prisma.userTeam.findUnique).mockResolvedValue(null);
    const squad = validSquad();
    squad[1] = makePlayer(2, 2, 2); // replace second GK with a DEF
    vi.mocked(prisma.fplPlayer.findMany).mockResolvedValue(squad as any);

    await expect(initializeSquad('user-1', squad.map((p) => p.id)))
      .rejects.toThrow('INVALID_GK_COUNT');
  });

  it('throws INVALID_DEF_COUNT when squad has wrong number of defenders', async () => {
    vi.mocked(prisma.userTeam.findUnique).mockResolvedValue(null);
    const squad = validSquad();
    squad[6] = makePlayer(7, 3, 7); // replace one DEF with a MID → 4 DEF
    vi.mocked(prisma.fplPlayer.findMany).mockResolvedValue(squad as any);

    await expect(initializeSquad('user-1', squad.map((p) => p.id)))
      .rejects.toThrow('INVALID_DEF_COUNT');
  });

  it('throws INVALID_BUDGET when total cost exceeds 1000', async () => {
    vi.mocked(prisma.userTeam.findUnique).mockResolvedValue(null);
    const squad = validSquad().map((p) => ({ ...p, nowCost: 80 })); // 15×80 = 1200
    vi.mocked(prisma.fplPlayer.findMany).mockResolvedValue(squad as any);

    await expect(initializeSquad('user-1', squad.map((p) => p.id)))
      .rejects.toThrow('INVALID_BUDGET');
  });

  it('throws INVALID_MAX_3_PER_CLUB when 4 players share a club', async () => {
    vi.mocked(prisma.userTeam.findUnique).mockResolvedValue(null);
    const squad = validSquad();
    // Give 4 players the same teamId
    squad[0].teamId = 99;
    squad[1].teamId = 99;
    squad[2].teamId = 99;
    squad[3].teamId = 99;
    vi.mocked(prisma.fplPlayer.findMany).mockResolvedValue(squad as any);

    await expect(initializeSquad('user-1', squad.map((p) => p.id)))
      .rejects.toThrow('INVALID_MAX_3_PER_CLUB');
  });

  it('calls prisma.$transaction on a valid squad', async () => {
    vi.mocked(prisma.userTeam.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.fplPlayer.findMany).mockResolvedValue(validSquad() as any);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) =>
      fn({
        userTeam: { create: vi.fn().mockResolvedValue({ id: 'team-1', budget: 250, season: '2025-26' }) },
        userPick: { createMany: vi.fn().mockResolvedValue({ count: 15 }) },
        userGameweekState: { create: vi.fn().mockResolvedValue({}) },
      }),
    );

    await initializeSquad('user-1', validSquad().map((p) => p.id));

    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });
});

// ── updateLineup ──────────────────────────────────────────────────────────────

describe('updateLineup', () => {
  // Build a 15-pick squad: positions 1-11 starters, 12-15 bench
  // Starters: 1 GK (id=1), 4 DEF (2,3,4,5), 4 MID (6,7,8,9), 2 FWD (10,11)
  // Bench:    1 GK (id=12), 3 outfield (13,14,15)
  const starters = [
    makePlayer(1,  1, 1), // GK — captain slot
    makePlayer(2,  2, 2),
    makePlayer(3,  2, 3),
    makePlayer(4,  2, 4),
    makePlayer(5,  2, 5),
    makePlayer(6,  3, 6),
    makePlayer(7,  3, 7),
    makePlayer(8,  3, 8),
    makePlayer(9,  3, 9),
    makePlayer(10, 4, 10),
    makePlayer(11, 4, 11),
  ];
  const bench = [
    makePlayer(12, 1, 12),
    makePlayer(13, 2, 13),
    makePlayer(14, 3, 14),
    makePlayer(15, 4, 15),
  ];

  const picks = [
    ...starters.map((p, i) => makePick(p.id, i + 1, false, p)),
    ...bench.map((p, i)   => makePick(p.id, 12 + i, true, p)),
  ];

  beforeEach(() => {
    vi.mocked(prisma.userTeam.findUnique).mockResolvedValue({ id: 'team-1' } as any);
    vi.mocked(prisma.userPick.findMany).mockResolvedValue(picks as any);
    vi.mocked(prisma.userGameweekState.findUnique).mockResolvedValue({
      id: 'gws-1', userTeamId: 'team-1', gameweek: 34,
      freeTransfers: 1, transfersMade: 0, pointsHit: 0, activeChip: null,
    } as any);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) =>
      fn({ userPick: { update: vi.fn().mockResolvedValue({}) } }),
    );
  });

  it('throws WRONG_BENCH_ORDER when benchOrder does not have exactly 4 entries', async () => {
    await expect(updateLineup('user-1', 1, 2, [12, 13, 14]))
      .rejects.toThrow('WRONG_BENCH_ORDER');
  });

  it('throws WRONG_BENCH_ORDER when benchOrder contains duplicate player IDs', async () => {
    await expect(updateLineup('user-1', 1, 2, [12, 12, 13, 14]))
      .rejects.toThrow('WRONG_BENCH_ORDER');
  });

  it('throws INVALID_CAPTAIN when captain equals vice-captain', async () => {
    await expect(updateLineup('user-1', 6, 6, [12, 13, 14, 15]))
      .rejects.toThrow('INVALID_CAPTAIN');
  });

  it('throws INVALID_CAPTAIN when captain is on the bench', async () => {
    await expect(updateLineup('user-1', 12, 2, [12, 13, 14, 15]))
      .rejects.toThrow('INVALID_CAPTAIN');
  });

  it('throws NO_TEAM when the user has no team', async () => {
    vi.mocked(prisma.userTeam.findUnique).mockResolvedValue(null);

    await expect(updateLineup('user-1', 1, 2, [12, 13, 14, 15]))
      .rejects.toThrow('NO_TEAM');
  });

  it('throws WRONG_BENCH_ORDER when a bench player ID is not in the squad', async () => {
    await expect(updateLineup('user-1', 1, 2, [12, 13, 14, 999]))
      .rejects.toThrow('WRONG_BENCH_ORDER');
  });

  it('throws INVALID_FORMATION when starters violate formation rules', async () => {
    // Bench both FWD starters (10, 11) and the FWD from bench (15) → 0 FWD on pitch
    await expect(updateLineup('user-1', 1, 2, [10, 11, 15, 12]))
      .rejects.toThrow('INVALID_FORMATION');
  });

  it('runs the transaction on a valid lineup update', async () => {
    await updateLineup('user-1', 1, 2, [12, 13, 14, 15]);

    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });

  it('returns success and the current gameweek', async () => {
    const result = await updateLineup('user-1', 1, 2, [12, 13, 14, 15]);

    expect(result.success).toBe(true);
    expect(result.gameweek).toBe(34);
  });
});

// ── getMyTeam ─────────────────────────────────────────────────────────────────

describe('getMyTeam', () => {
  it('returns { team: null } when the user has no team', async () => {
    vi.mocked(prisma.userTeam.findUnique).mockResolvedValue(null);

    const result = await getMyTeam('user-1');

    expect(result).toEqual({ team: null });
  });

  it('returns team data with picks and total points', async () => {
    vi.mocked(prisma.userTeam.findUnique)
      .mockResolvedValueOnce({ id: 'team-1' } as any)  // teamRef lookup
      .mockResolvedValueOnce({                          // full team with picks
        id: 'team-1',
        name: 'My Team',
        budget: 250,
        picks: [
          {
            id: 'pick-1',
            playerId: 1,
            position: 1,
            isCaptain: true,
            isViceCaptain: false,
            isOnBench: false,
            benchOrder: null,
            player: {
              position: 1,
              webName: 'Raya',
              nowCost: 55,
              status: 'a',
              totalPoints: 80,
              chanceOfPlayingNextRound: null,
              team: { id: 1, name: 'Arsenal', shortName: 'ARS' },
            },
          },
        ],
      } as any);

    vi.mocked(prisma.userGameweekState.findUnique).mockResolvedValue({
      id: 'gws-1', userTeamId: 'team-1', gameweek: 34,
      freeTransfers: 1, transfersMade: 0, pointsHit: 0, activeChip: null,
    } as any);
    vi.mocked(prisma.userGameweekState.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.userGameweekScore.aggregate).mockResolvedValue({
      _sum: { finalPoints: 420 },
    } as any);

    const result = await getMyTeam('user-1');

    expect(result.team).not.toBeNull();
    expect(result.team?.name).toBe('My Team');
    expect(result.team?.totalPoints).toBe(420);
    expect(result.team?.picks).toHaveLength(1);
    expect(result.team?.picks[0].webName).toBe('Raya');
  });
});
