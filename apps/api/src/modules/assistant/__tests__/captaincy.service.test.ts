// apps/api/src/modules/ai/__tests__/captaincy.service.test.ts
//
// Unit tests for getCaptainRecommendations with mocked Prisma.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db/prisma.js', () => ({
  prisma: {
    userTeam: {
      findUnique: vi.fn(),
    },
    userPick: {
      findMany: vi.fn(),
    },
    fplFixture: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('../../../utils/gameweek.js', () => ({
  getEditableGameweekId: vi.fn().mockResolvedValue(34),
}));

import { prisma } from '../../../db/prisma.js';
import { getCaptainRecommendations } from '../captaincy.service.js';

const mockPrisma = prisma as any;

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePickWithPlayer(overrides: {
  playerId:   number;
  webName:    string;
  position:   number;   // 1=GK 2=DEF 3=MID 4=FWD
  form:       number;
  totalPoints: number;
  chanceOfPlayingNextRound?: number;
  status?:    string;
  teamId:     number;
  shortName:  string;
}) {
  return {
    player: {
      id:                       overrides.playerId,
      webName:                  overrides.webName,
      position:                 overrides.position,
      form:                     overrides.form,
      totalPoints:              overrides.totalPoints,
      chanceOfPlayingNextRound: overrides.chanceOfPlayingNextRound ?? 100,
      status:                   overrides.status ?? 'a',
      teamId:                   overrides.teamId,
      team: { shortName: overrides.shortName },
    },
  };
}

const easyFixtures = [
  { teamHId: 10, teamAId: 99, teamHDifficulty: 2, teamADifficulty: 4 },
];

const hardFixtures = [
  { teamHId: 10, teamAId: 99, teamHDifficulty: 5, teamADifficulty: 2 },
];

// ── getCaptainRecommendations ─────────────────────────────────────────────────

describe('getCaptainRecommendations', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.userTeam.findUnique.mockResolvedValue({ id: 'team_1' });
    mockPrisma.fplFixture.findMany.mockResolvedValue(easyFixtures);
  });

  it('returns empty array when user has no team', async () => {
    mockPrisma.userTeam.findUnique.mockResolvedValue(null);
    const result = await getCaptainRecommendations('user_no_team');
    expect(result).toEqual([]);
  });

  it('returns empty array when no starters exist', async () => {
    mockPrisma.userPick.findMany.mockResolvedValue([]);
    const result = await getCaptainRecommendations('user_1');
    expect(result).toEqual([]);
  });

  it('excludes GK (position 1) from captain candidates', async () => {
    mockPrisma.userPick.findMany.mockResolvedValue([
      makePickWithPlayer({ playerId: 1, webName: 'GK',    position: 1, form: 8, totalPoints: 60, teamId: 10, shortName: 'MCI' }),
      makePickWithPlayer({ playerId: 2, webName: 'Salah', position: 3, form: 7, totalPoints: 80, teamId: 10, shortName: 'MCI' }),
    ]);

    const result = await getCaptainRecommendations('user_1');
    const ids = result.map((c) => c.playerId);
    expect(ids).not.toContain(1); // GK excluded
    expect(ids).toContain(2);     // MID included
  });

  it('returns at most 3 candidates', async () => {
    mockPrisma.userPick.findMany.mockResolvedValue([
      makePickWithPlayer({ playerId: 1, webName: 'P1', position: 3, form: 8, totalPoints: 80, teamId: 10, shortName: 'MCI' }),
      makePickWithPlayer({ playerId: 2, webName: 'P2', position: 4, form: 7, totalPoints: 70, teamId: 11, shortName: 'ARS' }),
      makePickWithPlayer({ playerId: 3, webName: 'P3', position: 3, form: 6, totalPoints: 60, teamId: 12, shortName: 'CHE' }),
      makePickWithPlayer({ playerId: 4, webName: 'P4', position: 4, form: 5, totalPoints: 50, teamId: 13, shortName: 'LIV' }),
      makePickWithPlayer({ playerId: 5, webName: 'P5', position: 2, form: 4, totalPoints: 40, teamId: 14, shortName: 'TOT' }),
    ]);

    const result = await getCaptainRecommendations('user_1');
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('sorts candidates by composite score descending', async () => {
    mockPrisma.userPick.findMany.mockResolvedValue([
      makePickWithPlayer({ playerId: 1, webName: 'LowForm',  position: 3, form: 1, totalPoints: 10, teamId: 10, shortName: 'MCI' }),
      makePickWithPlayer({ playerId: 2, webName: 'HighForm', position: 3, form: 9, totalPoints: 90, teamId: 10, shortName: 'MCI' }),
    ]);

    const result = await getCaptainRecommendations('user_1');
    expect(result[0].playerId).toBe(2); // HighForm first
  });

  it('gives position bonus to FWD (pos 4) over DEF (pos 2)', async () => {
    // Same form and points — FWD gets +5, DEF gets +1
    mockPrisma.userPick.findMany.mockResolvedValue([
      makePickWithPlayer({ playerId: 1, webName: 'Defender', position: 2, form: 6, totalPoints: 60, teamId: 10, shortName: 'MCI' }),
      makePickWithPlayer({ playerId: 2, webName: 'Forward',  position: 4, form: 6, totalPoints: 60, teamId: 10, shortName: 'MCI' }),
    ]);

    const result = await getCaptainRecommendations('user_1');
    expect(result[0].playerId).toBe(2); // FWD scores higher
    expect(result[0].score).toBeGreaterThan(result[1]?.score ?? 0);
  });

  it('includes availability risk in the risk array for injured player', async () => {
    mockPrisma.userPick.findMany.mockResolvedValue([
      makePickWithPlayer({ playerId: 1, webName: 'Injured', position: 3, form: 7, totalPoints: 70, teamId: 10, shortName: 'MCI', status: 'd', chanceOfPlayingNextRound: 50 }),
    ]);

    const result = await getCaptainRecommendations('user_1');
    expect(result[0].risk.length).toBeGreaterThan(0);
    expect(result[0].risk.some((r) => r.includes('availability') || r.includes('status'))).toBe(true);
  });

  it('each candidate has webName, club, position, score, reasons, risk', async () => {
    mockPrisma.userPick.findMany.mockResolvedValue([
      makePickWithPlayer({ playerId: 1, webName: 'Salah', position: 3, form: 8, totalPoints: 90, teamId: 10, shortName: 'LIV' }),
    ]);

    const [candidate] = await getCaptainRecommendations('user_1');
    expect(candidate).toHaveProperty('playerId');
    expect(candidate).toHaveProperty('webName', 'Salah');
    expect(candidate).toHaveProperty('club');
    expect(candidate).toHaveProperty('position');
    expect(candidate).toHaveProperty('score');
    expect(Array.isArray(candidate.reasons)).toBe(true);
    expect(Array.isArray(candidate.risk)).toBe(true);
  });

  it('mentions strong form in reasons when form >= 5', async () => {
    mockPrisma.userPick.findMany.mockResolvedValue([
      makePickWithPlayer({ playerId: 1, webName: 'InForm', position: 3, form: 7, totalPoints: 80, teamId: 10, shortName: 'MCI' }),
    ]);

    const [candidate] = await getCaptainRecommendations('user_1');
    expect(candidate.reasons.some((r) => r.includes('form'))).toBe(true);
  });

  it('handles players with null form gracefully', async () => {
    mockPrisma.userPick.findMany.mockResolvedValue([
      makePickWithPlayer({ playerId: 1, webName: 'NoForm', position: 3, form: null as any, totalPoints: 60, teamId: 10, shortName: 'MCI' }),
    ]);

    await expect(getCaptainRecommendations('user_1')).resolves.not.toThrow();
  });
});