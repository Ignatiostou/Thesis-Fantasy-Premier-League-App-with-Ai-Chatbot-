// apps/api/src/modules/ai/__tests__/recommendation.service.test.ts
//
// Fix: mock path was '../projection.engine.js' but actual file on disk is
// '../projection.service.js'. Stack trace confirmed:
//   at projectCaptainOptions (projection.service.ts:395)
// Also: vi.clearAllMocks() in beforeEach was wiping mock return values.
// Added mockReturnValue/mockResolvedValue setup inside beforeEach.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../captaincy.service.js', () => ({
  getCaptainRecommendations: vi.fn(),
}));

vi.mock('../player-comparison.service.js', () => ({
  compareMentionedPlayers: vi.fn(),
}));

vi.mock('../transfer-evaluator.service.js', () => ({
  evaluateMentionedTransfer: vi.fn(),
}));

// Fix: correct path — projection.service.js not projection.engine.js
vi.mock('../projection.service.js', () => ({
  projectCaptainOptions: vi.fn(),
  projectTransferDelta:  vi.fn(),
  projectPlayer:         vi.fn(),
}));

vi.mock('../projection.formatter.js', () => ({
  formatCaptainProjection: vi.fn().mockReturnValue(''),
  formatTransferDelta:     vi.fn().mockReturnValue(''),
  formatPlayerProjection:  vi.fn().mockReturnValue(''),
}));

vi.mock('../squad-intelligence.engine.js', () => ({
  buildSquadIntelligence: vi.fn(),
  analyseWeakLinks:       vi.fn(),
  optimiseLineup:         vi.fn(),
  optimiseBenchOrder:     vi.fn(),
  recommendFormation:     vi.fn(),
}));

vi.mock('../squad-intelligence.formatter.js', () => ({
  formatForIntent:               vi.fn().mockReturnValue('squad context'),
  formatLineupOptimization:      vi.fn().mockReturnValue(''),
  formatFormationRecommendation: vi.fn().mockReturnValue('formation advice'),
  formatBenchOrder:              vi.fn().mockReturnValue('bench order'),
  formatWeakLinks:               vi.fn().mockReturnValue(''),
}));

vi.mock('../player-search.service.js', () => ({
  findMentionedPlayers: vi.fn(),
}));

vi.mock('../ml-recommendation-engine.service.js', () => ({
  buildMlRecommendationBlock: vi.fn(),
}));

vi.mock('../../../utils/gameweek.js', () => ({
  getEditableGameweekId: vi.fn().mockResolvedValue(34),
}));

vi.mock('../../../db/prisma.js', () => ({
  prisma: {
    userTeam: {
      findUnique: vi.fn().mockResolvedValue({ id: 'team_1' }),
    },
    userPick: {
      findMany: vi.fn().mockResolvedValue([{ playerId: 1 }, { playerId: 2 }]),
    },
    userGameweekState: {
      findUnique: vi.fn().mockResolvedValue({ freeTransfers: 1, transfersMade: 0 }),
    },
    fplPlayer: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}));

import { buildRecommendationContext } from '../recommendation.service.js';
import { getCaptainRecommendations }  from '../captaincy.service.js';
import { compareMentionedPlayers }    from '../player-comparison.service.js';
import { evaluateMentionedTransfer }  from '../transfer-evaluator.service.js';
import { buildMlRecommendationBlock } from '../ml-recommendation-engine.service.js';
import { buildSquadIntelligence, optimiseBenchOrder, recommendFormation, optimiseLineup, analyseWeakLinks } from '../squad-intelligence.engine.js';
import { findMentionedPlayers }       from '../player-search.service.js';
import { projectCaptainOptions, projectTransferDelta } from '../projection.service.js';

const ML_UNAVAILABLE = {
  available:   false,
  intent:      'CAPTAINCY' as const,
  summary:     'No ML predictions.',
  structured:  null,
  promptBlock: '',
};

const CAPTAIN_CANDIDATES = [
  {
    playerId: 1, webName: 'Salah', club: 'LIV', position: 'MID', score: 42,
    reasons: ['strong form'], risk: [],
    // IMPROVEMENT #2: explanation is guaranteed on every candidate now — see
    // recommendation.types.ts RecommendationExplanation.
    explanation: {
      upside: '+3.2 expected points vs. current captain',
      risk: 'none identified',
      horizon: 'GW1' as const,
      alternative: 'None — clear top pick.',
      confidence: 'HIGH' as const,
    },
  },
];

const COMPARISON_RESULT = {
  found: true,
  players: [
    { playerId: 1, webName: 'Salah',   club: 'LIV', position: 'MID', nowCost: 130, totalPoints: 180, form: 7.5, chanceOfPlayingNextRound: 100, status: 'a', pros: ['form'], cons: [] },
    { playerId: 2, webName: 'Haaland', club: 'MCI', position: 'FWD', nowCost: 145, totalPoints: 200, form: 8.0, chanceOfPlayingNextRound: 100, status: 'a', pros: ['goals'], cons: [] },
  ],
  recommendation: 'Haaland edges it.',
};

const TRANSFER_RESULT = {
  detected:       true,
  outgoingPlayer: { playerId: 3, webName: 'Weak', club: 'SOU', position: 'MID', sellPrice: 45 },
  incomingPlayer: { playerId: 4, webName: 'Strong', club: 'ARS', position: 'MID', buyPrice: 80, totalPoints: 90, form: 6, status: 'a', chanceOfPlayingNextRound: 100 },
  budgetImpact:   { bankBefore: 10, bankAfter: -25, affordable: false },
  ruleCheck:      { samePosition: true, maxPerClubLikelyOk: true },
  recommendation: 'Transfer not affordable.',
  risks:          ['Insufficient budget'],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('buildRecommendationContext', () => {

  // Fix: reset all mocks to working defaults before each test
  // so vi.clearAllMocks() doesn't break them
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(getCaptainRecommendations).mockResolvedValue(CAPTAIN_CANDIDATES as any);
    vi.mocked(compareMentionedPlayers).mockResolvedValue(COMPARISON_RESULT as any);
    vi.mocked(evaluateMentionedTransfer).mockResolvedValue(TRANSFER_RESULT as any);
    vi.mocked(buildMlRecommendationBlock).mockResolvedValue(ML_UNAVAILABLE as any);
    vi.mocked(projectCaptainOptions).mockResolvedValue(null);
    vi.mocked(projectTransferDelta).mockResolvedValue(null);
    vi.mocked(buildSquadIntelligence).mockResolvedValue({ starters: [], bench: [] } as any);
    vi.mocked(analyseWeakLinks).mockResolvedValue(null);
    vi.mocked(optimiseLineup).mockResolvedValue(null);
    vi.mocked(optimiseBenchOrder).mockResolvedValue({ benchOrder: [], reasoning: 'mock' } as any);
    vi.mocked(recommendFormation).mockResolvedValue({ recommended: '4-3-3', reason: 'balance' } as any);
    vi.mocked(findMentionedPlayers).mockResolvedValue([
      { id: 1, webName: 'Salah' },
      { id: 2, webName: 'Haaland' },
    ] as any);
  });

  // ── CAPTAINCY ──────────────────────────────────────────────────────────────

  describe('CAPTAINCY intent', () => {

    it('returns a non-null result', async () => {
      const result = await buildRecommendationContext({ userId: 'user_1', intent: 'CAPTAINCY', message: 'captain?' });
      expect(result).not.toBeNull();
    });

    it('returns CAPTAINCY intent', async () => {
      const result = await buildRecommendationContext({ userId: 'user_1', intent: 'CAPTAINCY', message: 'captain?' });
      expect(result?.intent).toBe('CAPTAINCY');
    });

    it('summary contains captain analysis text', async () => {
      const result = await buildRecommendationContext({ userId: 'user_1', intent: 'CAPTAINCY', message: 'captain?' });
      expect(result?.summary).toContain('CAPTAINCY');
    });

    it('structured data includes candidates', async () => {
      const result = await buildRecommendationContext({ userId: 'user_1', intent: 'CAPTAINCY', message: 'captain?' });
      expect(result?.structured).toHaveProperty('candidates');
    });

    it('includes mlBlock in result', async () => {
      const result = await buildRecommendationContext({ userId: 'user_1', intent: 'CAPTAINCY', message: 'captain?' });
      expect(result).toHaveProperty('mlBlock');
    });
  });

  // ── PLAYER_COMPARISON ──────────────────────────────────────────────────────

  describe('PLAYER_COMPARISON intent', () => {

    it('returns a non-null result', async () => {
      const result = await buildRecommendationContext({ userId: 'user_1', intent: 'PLAYER_COMPARISON', message: 'salah vs haaland' });
      expect(result).not.toBeNull();
    });

    it('summary contains comparison text', async () => {
      const result = await buildRecommendationContext({ userId: 'user_1', intent: 'PLAYER_COMPARISON', message: 'salah vs haaland' });
      expect(result?.summary).toContain('COMPARISON');
    });

    it('structured data includes comparison', async () => {
      const result = await buildRecommendationContext({ userId: 'user_1', intent: 'PLAYER_COMPARISON', message: 'salah vs haaland' });
      expect(result?.structured).toHaveProperty('comparison');
    });
  });

  // ── TRANSFER_ADVICE ────────────────────────────────────────────────────────

  describe('TRANSFER_ADVICE intent', () => {

    it('returns a non-null result', async () => {
      const result = await buildRecommendationContext({ userId: 'user_1', intent: 'TRANSFER_ADVICE', message: 'transfer haaland' });
      expect(result).not.toBeNull();
    });

    it('summary contains TRANSFER text', async () => {
      const result = await buildRecommendationContext({ userId: 'user_1', intent: 'TRANSFER_ADVICE', message: 'transfer haaland' });
      expect(result?.summary).toContain('TRANSFER');
    });

    it('mentions NOT AFFORDABLE when budget insufficient', async () => {
      const result = await buildRecommendationContext({ userId: 'user_1', intent: 'TRANSFER_ADVICE', message: 'transfer haaland' });
      expect(result?.summary).toContain('NOT AFFORDABLE');
    });
  });

  // ── TRANSFER_EVALUATION ────────────────────────────────────────────────────

  describe('TRANSFER_EVALUATION intent', () => {

    it('returns a non-null result', async () => {
      const result = await buildRecommendationContext({ userId: 'user_1', intent: 'TRANSFER_EVALUATION', message: 'worth the hit?' });
      expect(result).not.toBeNull();
    });

    it('returns TRANSFER_EVALUATION intent', async () => {
      const result = await buildRecommendationContext({ userId: 'user_1', intent: 'TRANSFER_EVALUATION', message: 'worth the hit?' });
      expect(result?.intent).toBe('TRANSFER_EVALUATION');
    });

    it('summary contains transfer evaluation text', async () => {
      const result = await buildRecommendationContext({ userId: 'user_1', intent: 'TRANSFER_EVALUATION', message: 'worth the hit?' });
      expect(result?.summary).toContain('TRANSFER');
    });
  });

  // ── FORMATION_ADVICE ───────────────────────────────────────────────────────

  describe('FORMATION_ADVICE intent', () => {

    it('returns a non-null result', async () => {
      const result = await buildRecommendationContext({ userId: 'user_1', intent: 'FORMATION_ADVICE', message: 'best formation?' });
      expect(result).not.toBeNull();
    });

    it('returns FORMATION_ADVICE intent', async () => {
      const result = await buildRecommendationContext({ userId: 'user_1', intent: 'FORMATION_ADVICE', message: 'best formation?' });
      expect(result?.intent).toBe('FORMATION_ADVICE');
    });

    it('structured data includes formation recommendation', async () => {
      const result = await buildRecommendationContext({ userId: 'user_1', intent: 'FORMATION_ADVICE', message: 'best formation?' });
      expect(result?.structured).toHaveProperty('formation');
    });
  });

  // ── BENCH_ORDER ────────────────────────────────────────────────────────────

  describe('BENCH_ORDER intent', () => {

    it('returns a non-null result', async () => {
      const result = await buildRecommendationContext({ userId: 'user_1', intent: 'BENCH_ORDER', message: 'bench order?' });
      expect(result).not.toBeNull();
    });

    it('returns BENCH_ORDER intent', async () => {
      const result = await buildRecommendationContext({ userId: 'user_1', intent: 'BENCH_ORDER', message: 'bench order?' });
      expect(result?.intent).toBe('BENCH_ORDER');
    });
  });

  // ── GENERAL_HELP ───────────────────────────────────────────────────────────

  describe('GENERAL_HELP intent', () => {

    it('returns a non-null result', async () => {
      const result = await buildRecommendationContext({ userId: 'user_1', intent: 'GENERAL_HELP', message: 'any advice?' });
      expect(result).not.toBeNull();
    });

    it('returns GENERAL_HELP intent', async () => {
      const result = await buildRecommendationContext({ userId: 'user_1', intent: 'GENERAL_HELP', message: 'any advice?' });
      expect(result?.intent).toBe('GENERAL_HELP');
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  describe('error handling', () => {

    it('returns null for ONBOARDING intent', async () => {
      const result = await buildRecommendationContext({ userId: 'user_1', intent: 'ONBOARDING', message: 'onboarding' });
      expect(result).toBeNull();
    });

    it('never throws — catches errors and returns null', async () => {
      vi.mocked(getCaptainRecommendations).mockRejectedValueOnce(new Error('DB crashed'));
      const result = await buildRecommendationContext({ userId: 'user_1', intent: 'CAPTAINCY', message: 'captain?' });
      expect(result).toBeNull();
    });
  });
});