// apps/api/src/modules/ai/__tests__/prompt.service.test.ts
//
// Unit tests for buildSystemPrompt — pure function, no mocks needed.

import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../prompt.service.js';
import type { UserContext } from '../context.service.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseCtx: UserContext = {
  username:         'testmanager',
  gameweek:         34,
  liveGameweek:     33,
  hasTeam:          true,
  teamName:         'Test FC',
  budgetLeft:       '£2.0m',
  freeTransfers:    1,
  activeChip:       null,
  profileSummary:   'Risk profile: balanced\nExplanation preference: medium detail explanations',
  squad:            [],
  recentScores:     [],
  upcomingFixtures: [],
  teamStats:        [],
};

// ── buildSystemPrompt ─────────────────────────────────────────────────────────

describe('buildSystemPrompt', () => {

  it('returns a non-empty string', () => {
    const prompt = buildSystemPrompt(baseCtx);
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(100);
  });

  it('mentions CoachBot in the prompt', () => {
    const prompt = buildSystemPrompt(baseCtx);
    expect(prompt).toContain('CoachBot');
  });

  it('includes the manager username', () => {
    const prompt = buildSystemPrompt(baseCtx);
    expect(prompt).toContain('testmanager');
  });

  it('includes the CRITICAL anti-hallucination instruction', () => {
    const prompt = buildSystemPrompt(baseCtx);
    expect(prompt).toContain('CRITICAL');
    expect(prompt.toLowerCase()).toContain('hallucinate');
  });

  // ── Recommendation block injection ────────────────────────────────────────

  it('includes recommendation block when provided', () => {
    const recBlock = '=== CAPTAINCY ANALYSIS ===\nSalah scores 42/100';
    const prompt = buildSystemPrompt(baseCtx, recBlock);
    expect(prompt).toContain('CAPTAINCY ANALYSIS');
    expect(prompt).toContain('Salah scores 42/100');
  });

  it('does not include COMPUTED RECOMMENDATION section when no block provided', () => {
    const prompt = buildSystemPrompt(baseCtx, null);
    expect(prompt).not.toContain('COMPUTED RECOMMENDATION DATA');
  });

  it('does not include COMPUTED RECOMMENDATION section for empty string block', () => {
    const prompt = buildSystemPrompt(baseCtx, '');
    expect(prompt).not.toContain('COMPUTED RECOMMENDATION DATA');
  });

  // ── Intent guidance ───────────────────────────────────────────────────────

  it('includes CAPTAINCY task guidance for CAPTAINCY intent', () => {
    const prompt = buildSystemPrompt(baseCtx, null, 'CAPTAINCY');
    expect(prompt).toContain('CAPTAINCY');
    expect(prompt.toLowerCase()).toContain('captain');
  });

  it('includes TRANSFER task guidance for TRANSFER_ADVICE intent', () => {
    const prompt = buildSystemPrompt(baseCtx, null, 'TRANSFER_ADVICE');
    expect(prompt.toLowerCase()).toContain('transfer');
  });

  it('includes BENCH task guidance for BENCH_ORDER intent', () => {
    const prompt = buildSystemPrompt(baseCtx, null, 'BENCH_ORDER');
    expect(prompt.toLowerCase()).toContain('bench');
  });

  it('includes CHIP task guidance for CHIP_ADVICE intent', () => {
    const prompt = buildSystemPrompt(baseCtx, null, 'CHIP_ADVICE');
    expect(prompt.toLowerCase()).toContain('chip');
  });

  it('includes COMPARISON task guidance for PLAYER_COMPARISON intent', () => {
    const prompt = buildSystemPrompt(baseCtx, null, 'PLAYER_COMPARISON');
    expect(prompt.toLowerCase()).toContain('compar');
  });

  // ── Explanation depth ─────────────────────────────────────────────────────

  it('uses BRIEF guidance for brief profile', () => {
    const ctx = { ...baseCtx, profileSummary: 'Explanation preference: brief explanations' };
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain('BRIEF');
  });

  it('uses DETAILED guidance for highly detailed profile', () => {
    const ctx = { ...baseCtx, profileSummary: 'Explanation preference: highly detailed explanations' };
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain('DETAILED');
  });

  it('uses MEDIUM guidance when profile has no depth preference', () => {
    const ctx = { ...baseCtx, profileSummary: 'Risk profile: balanced' };
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain('MEDIUM');
  });

  // ── FPL rules section ─────────────────────────────────────────────────────

  it('mentions key FPL rules', () => {
    const prompt = buildSystemPrompt(baseCtx);
    expect(prompt).toContain('£100m');
    expect(prompt).toContain('Max 3 players');
    expect(prompt).toContain('-4 pts');
    expect(prompt).toContain('Wildcard');
  });

  // ── Output structure ──────────────────────────────────────────────────────

  it('asks for a Recommendation section in the response', () => {
    const prompt = buildSystemPrompt(baseCtx);
    expect(prompt).toContain('Recommendation');
    expect(prompt).toContain('Reasoning');
    expect(prompt).toContain('Risk');
    expect(prompt).toContain('Alternative');
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it('handles null profileSummary without crashing', () => {
    const ctx = { ...baseCtx, profileSummary: null };
    expect(() => buildSystemPrompt(ctx)).not.toThrow();
  });

  it('produces longer prompts with a recommendation block', () => {
    const withBlock    = buildSystemPrompt(baseCtx, '=== DATA ===\nsome data here');
    const withoutBlock = buildSystemPrompt(baseCtx, null);
    expect(withBlock.length).toBeGreaterThan(withoutBlock.length);
  });

  it('different intents produce different prompts', () => {
    const captaincy = buildSystemPrompt(baseCtx, null, 'CAPTAINCY');
    const transfer  = buildSystemPrompt(baseCtx, null, 'TRANSFER_ADVICE');
    expect(captaincy).not.toBe(transfer);
  });
});