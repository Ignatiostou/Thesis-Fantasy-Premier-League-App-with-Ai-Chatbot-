// apps/api/src/modules/ai/__tests__/player-comparison.service.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../player-search.service.js', () => ({
  findMentionedPlayers: vi.fn(),
}));

import { findMentionedPlayers } from '../player-search.service.js';
import { compareMentionedPlayers } from '../player-comparison.service.js';

function makePlayer(id: number, overrides: any = {}): any {
  return {
    id,
    webName: overrides.webName ?? `Player${id}`,
    nowCost: overrides.nowCost ?? 80,
    position: overrides.position ?? 3,
    totalPoints: overrides.totalPoints ?? 60,

    // important fix: allow explicit null/undefined form
    form: Object.prototype.hasOwnProperty.call(overrides, 'form')
      ? overrides.form
      : 5.0,

    chanceOfPlayingNextRound: overrides.chance ?? 100,
    status: overrides.status ?? 'a',
    team: { shortName: overrides.club ?? 'TST' },
  };
}

describe('compareMentionedPlayers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns found:false when fewer than 2 players identified', async () => {
    vi.mocked(findMentionedPlayers).mockResolvedValue([makePlayer(1)]);

    const result = await compareMentionedPlayers('salah');

    expect(result.found).toBe(false);
    expect(result.players).toHaveLength(0);
    expect(result.recommendation).toContain('could not confidently identify');
  });

  it('returns found:false when no players identified', async () => {
    vi.mocked(findMentionedPlayers).mockResolvedValue([]);

    const result = await compareMentionedPlayers('compare players');

    expect(result.found).toBe(false);
  });

  it('returns found:true with exactly 2 players when more are found', async () => {
    vi.mocked(findMentionedPlayers).mockResolvedValue([
      makePlayer(1),
      makePlayer(2),
      makePlayer(3),
    ]);

    const result = await compareMentionedPlayers('compare three players');

    expect(result.found).toBe(true);
    expect(result.players).toHaveLength(2);
  });

  // ── Pros generation ──────────────────────────────────────────────────────────

  it('adds strong season output pro when totalPoints >= 100', async () => {
    vi.mocked(findMentionedPlayers).mockResolvedValue([
      makePlayer(1, { totalPoints: 120 }),
      makePlayer(2, { totalPoints: 50 }),
    ]);

    const result = await compareMentionedPlayers('compare');

    expect(result.players[0].pros).toContain('strong season output');
    expect(result.players[1].pros).not.toContain('strong season output');
  });

  it('adds excellent form pro when form >= 5', async () => {
    vi.mocked(findMentionedPlayers).mockResolvedValue([
      makePlayer(1, { form: 7.5 }),
      makePlayer(2, { form: 3.0 }),
    ]);

    const result = await compareMentionedPlayers('compare');

    expect(result.players[0].pros.some((p: string) => p.includes('form'))).toBe(true);
    expect(result.players[1].pros.some((p: string) => p.includes('form'))).toBe(false);
  });

  it('adds good availability pro when chanceOfPlayingNextRound >= 75', async () => {
    vi.mocked(findMentionedPlayers).mockResolvedValue([
      makePlayer(1, { chance: 100 }),
      makePlayer(2, { chance: 50 }),
    ]);

    const result = await compareMentionedPlayers('compare');

    expect(result.players[0].pros).toContain('good expected availability');
    expect(result.players[1].pros).not.toContain('good expected availability');
  });

  // ── Cons generation ──────────────────────────────────────────────────────────

  it('adds availability con when chance < 75', async () => {
    vi.mocked(findMentionedPlayers).mockResolvedValue([
      makePlayer(1, { chance: 50 }),
      makePlayer(2),
    ]);

    const result = await compareMentionedPlayers('compare');

    expect(result.players[0].cons.some((c: string) => c.includes('availability'))).toBe(true);
  });

  it('adds status con when player is not available', async () => {
    vi.mocked(findMentionedPlayers).mockResolvedValue([
      makePlayer(1, { status: 'd' }),
      makePlayer(2),
    ]);

    const result = await compareMentionedPlayers('compare');

    expect(result.players[0].cons.some((c: string) => c.includes('status flag'))).toBe(true);
  });

  it('adds weak season con when totalPoints < 40', async () => {
    vi.mocked(findMentionedPlayers).mockResolvedValue([
      makePlayer(1, { totalPoints: 20 }),
      makePlayer(2, { totalPoints: 80 }),
    ]);

    const result = await compareMentionedPlayers('compare');

    expect(result.players[0].cons).toContain('weaker season sample so far');
    expect(result.players[1].cons).not.toContain('weaker season sample so far');
  });

  // ── Composite scoring ────────────────────────────────────────────────────────

  it('recommends the higher-scoring player', async () => {
    vi.mocked(findMentionedPlayers).mockResolvedValue([
      makePlayer(1, {
        webName: 'Salah',
        totalPoints: 150,
        form: 8,
        chance: 100,
        status: 'a',
      }),
      makePlayer(2, {
        webName: 'Weakling',
        totalPoints: 50,
        form: 3,
        chance: 100,
        status: 'a',
      }),
    ]);

    const result = await compareMentionedPlayers('compare');

    expect(result.recommendation).toContain('Salah');
  });

  it('penalises unavailable status in composite score', async () => {
    vi.mocked(findMentionedPlayers).mockResolvedValue([
      makePlayer(1, {
        webName: 'Available',
        totalPoints: 80,
        form: 6,
        status: 'a',
      }),
      makePlayer(2, {
        webName: 'Injured',
        totalPoints: 80,
        form: 6,
        status: 'd',
      }),
    ]);

    const result = await compareMentionedPlayers('compare');

    expect(result.recommendation).toContain('Available');
  });

  // ── safeForm edge cases ──────────────────────────────────────────────────────

  it('handles string form values gracefully', async () => {
    vi.mocked(findMentionedPlayers).mockResolvedValue([
      makePlayer(1, { form: '6.5' }),
      makePlayer(2, { form: '3.0' }),
    ]);

    const result = await compareMentionedPlayers('compare');

    expect(result.found).toBe(true);
    expect(result.players[0].form).toBe(6.5);
  });

  it('handles null/undefined form gracefully', async () => {
    vi.mocked(findMentionedPlayers).mockResolvedValue([
      makePlayer(1, { form: null }),
      makePlayer(2, { form: undefined }),
    ]);

    await expect(compareMentionedPlayers('compare')).resolves.not.toThrow();

    const result = await compareMentionedPlayers('compare');

    expect(result.players[0].form).toBeNull();
  });

  // ── Output shape ─────────────────────────────────────────────────────────────

  it('each player has required fields', async () => {
    vi.mocked(findMentionedPlayers).mockResolvedValue([
      makePlayer(1),
      makePlayer(2),
    ]);

    const result = await compareMentionedPlayers('compare');

    for (const p of result.players) {
      expect(p).toHaveProperty('playerId');
      expect(p).toHaveProperty('webName');
      expect(p).toHaveProperty('club');
      expect(p).toHaveProperty('position');
      expect(p).toHaveProperty('nowCost');
      expect(p).toHaveProperty('totalPoints');
      expect(p).toHaveProperty('pros');
      expect(p).toHaveProperty('cons');
      expect(Array.isArray(p.pros)).toBe(true);
      expect(Array.isArray(p.cons)).toBe(true);
    }
  });
});