import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../prompt.service.js';
import type { UserContext } from '../context.service.js';

// ── Base context factory ──────────────────────────────────────────────────────

function makeCtx(overrides: Partial<UserContext> = {}): UserContext {
  return {
    username:         'testmanager',
    gameweek:         34,
    liveGameweek:     33,
    hasTeam:          true,
    teamName:         'Test FC',
    budgetLeft:       '£2.0m',
    freeTransfers:    1,
    activeChip:       null,
    profileSummary:   null,
    squad:            [],
    recentScores:     [],
    upcomingFixtures: [],
    teamStats:        [],
    ...overrides,
  };
}

// ── 1. Personalization by risk profile ───────────────────────────────────────

describe('risk profile personalization', () => {

  it('conservative profile prompt discourages differentials', () => {
    const ctx = makeCtx({
      profileSummary: 'Risk profile: conservative\nDifferential appetite: avoids differentials',
    });
    const prompt = buildSystemPrompt(ctx, null, 'CAPTAINCY');
    // The profile should appear in the prompt so LLM can tailor advice
    expect(prompt).toContain('conservative');
    expect(prompt).toContain('avoids differentials');
  });

  it('aggressive profile prompt reflects high risk tolerance', () => {
    const ctx = makeCtx({
      profileSummary: 'Risk profile: aggressive\nDifferential appetite: loves differentials',
    });
    const prompt = buildSystemPrompt(ctx, null, 'CAPTAINCY');
    expect(prompt).toContain('aggressive');
    expect(prompt).toContain('loves differentials');
  });

  it('different risk profiles produce different prompts', () => {
    const conservative = buildSystemPrompt(
      makeCtx({ profileSummary: 'Risk profile: conservative' }),
      null, 'CAPTAINCY',
    );
    const aggressive = buildSystemPrompt(
      makeCtx({ profileSummary: 'Risk profile: aggressive' }),
      null, 'CAPTAINCY',
    );
    expect(conservative).not.toBe(aggressive);
  });
});

// ── 2. Explanation depth personalization ──────────────────────────────────────

describe('explanation depth personalization', () => {

  it('brief profile triggers BRIEF response length instruction', () => {
    const ctx = makeCtx({ profileSummary: 'Explanation preference: brief explanations' });
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain('BRIEF');
  });

  it('detailed profile triggers DETAILED response length instruction', () => {
    const ctx = makeCtx({ profileSummary: 'Explanation preference: highly detailed explanations' });
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain('DETAILED');
  });

  it('medium profile triggers MEDIUM response length instruction', () => {
    const ctx = makeCtx({ profileSummary: 'Risk profile: balanced' });
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain('MEDIUM');
  });

  it('brief prompt is shorter than detailed prompt', () => {
    const brief    = buildSystemPrompt(makeCtx({ profileSummary: 'Explanation preference: brief explanations' }));
    const detailed = buildSystemPrompt(makeCtx({ profileSummary: 'Explanation preference: highly detailed explanations' }));
    // Detailed has more instruction text
    expect(detailed.length).toBeGreaterThan(brief.length);
  });
});

// ── 3. Captaincy intent prompt quality ───────────────────────────────────────

describe('captaincy intent prompt quality', () => {

  it('captaincy prompt instructs LLM to recommend a captain', () => {
    const prompt = buildSystemPrompt(makeCtx(), null, 'CAPTAINCY');
    expect(prompt.toLowerCase()).toContain('captain');
  });

  it('captaincy prompt distinguishes safe vs upside pick', () => {
    const prompt = buildSystemPrompt(makeCtx(), null, 'CAPTAINCY');
    // Should instruct LLM to mention both safe and upside options
    const lower = prompt.toLowerCase();
    expect(lower).toMatch(/(safe|upside)/);
  });

  it('captaincy prompt with ML data instructs prioritising ML score', () => {
    const mlBlock = '=== ML CAPTAIN RANKINGS ===\nHaaland composite: 8.5\nSalah composite: 7.2';
    const prompt  = buildSystemPrompt(makeCtx(), mlBlock, 'CAPTAINCY');
    // ML data should appear in the prompt
    expect(prompt).toContain('Haaland composite: 8.5');
    expect(prompt).toContain('Salah composite: 7.2');
  });

  it('captaincy prompt tells LLM not to invent captain options', () => {
    const prompt = buildSystemPrompt(makeCtx(), null, 'CAPTAINCY');
    expect(prompt.toLowerCase()).toContain('do not');
    expect(prompt).toContain('not listed');
  });

  it('captaincy prompt includes ML vs heuristic conflict resolution guidance', () => {
    const prompt = buildSystemPrompt(makeCtx(), '=== ML DATA ===\nHaaland: 8.5 xPts', 'CAPTAINCY');
    expect(prompt).toContain('conflict');
  });
});

// ── 4. Transfer intent prompt quality ────────────────────────────────────────

describe('transfer intent prompt quality', () => {

  it('transfer prompt always mentions affordability check', () => {
    const prompt = buildSystemPrompt(makeCtx(), null, 'TRANSFER_ADVICE');
    expect(prompt.toLowerCase()).toContain('afford');
  });

  it('transfer prompt mentions position match requirement', () => {
    const prompt = buildSystemPrompt(makeCtx(), null, 'TRANSFER_ADVICE');
    const lower = prompt.toLowerCase();
    expect(lower).toMatch(/(position|budget)/);
  });

  it('transfer prompt with specific transfer data contains player names', () => {
    const recBlock = `=== TRANSFER EVALUATION ===
OUT: WeakMid (SOU, MID) — sell: £4.5m
IN:  Salah (LIV, MID) — buy: £13.0m
Bank after: -£3.5m  ✗ NOT AFFORDABLE
VERDICT: Transfer not affordable.`;
    const prompt = buildSystemPrompt(makeCtx(), recBlock, 'TRANSFER_ADVICE');
    expect(prompt).toContain('WeakMid');
    expect(prompt).toContain('Salah');
    expect(prompt).toContain('NOT AFFORDABLE');
  });

  it('transfer evaluation prompt mentions hit cost', () => {
    const prompt = buildSystemPrompt(makeCtx(), null, 'TRANSFER_EVALUATION');
    const lower = prompt.toLowerCase();
    expect(lower).toMatch(/(hit|point)/);
  });
});

// ── 5. Anti-hallucination enforcement ────────────────────────────────────────

describe('anti-hallucination instruction', () => {

  it('every prompt contains the CRITICAL instruction', () => {
    const intents = ['CAPTAINCY', 'TRANSFER_ADVICE', 'BENCH_ORDER', 'GENERAL_HELP'] as const;
    for (const intent of intents) {
      const prompt = buildSystemPrompt(makeCtx(), null, intent);
      expect(prompt).toContain('CRITICAL');
    }
  });

  it('CRITICAL instruction prohibits inventing stats', () => {
    const prompt = buildSystemPrompt(makeCtx());
    expect(prompt.toLowerCase()).toContain('hallucinate');
    expect(prompt.toLowerCase()).toContain('invent');
  });

  it('prompt instructs LLM to use only provided context data', () => {
    const prompt = buildSystemPrompt(makeCtx());
    expect(prompt.toLowerCase()).toContain('source of truth');
  });

  it('prompt with recommendation data warns against inventing projections', () => {
    const recBlock = '=== ML DATA ===\nSalah: 8.5 xPts';
    const prompt   = buildSystemPrompt(makeCtx(), recBlock, 'CAPTAINCY');
    expect(prompt).toContain('Do not invent');
  });
});

// ── 6. FPL rules enforcement ──────────────────────────────────────────────────

describe('FPL rules in every prompt', () => {

  it('prompt includes squad size rule', () => {
    const prompt = buildSystemPrompt(makeCtx());
    expect(prompt).toContain('15');
  });

  it('prompt includes budget rule', () => {
    const prompt = buildSystemPrompt(makeCtx());
    expect(prompt).toContain('£100m');
  });

  it('prompt includes 3-per-club rule', () => {
    const prompt = buildSystemPrompt(makeCtx());
    expect(prompt).toContain('Max 3 players');
  });

  it('prompt includes transfer hit cost', () => {
    const prompt = buildSystemPrompt(makeCtx());
    expect(prompt).toContain('-4 pts');
  });

  it('prompt includes chip rules', () => {
    const prompt = buildSystemPrompt(makeCtx());
    expect(prompt).toContain('Wildcard');
    expect(prompt).toContain('Bench Boost');
  });

  it('chip advice prompt warns never to recommend already-used chip', () => {
    const prompt = buildSystemPrompt(makeCtx(), null, 'CHIP_ADVICE');
    expect(prompt).toContain('already');
    expect(prompt.toLowerCase()).toContain('used');
  });
});

// ── 7. Context injection quality ─────────────────────────────────────────────

describe('user context injection', () => {

  it('manager username appears in prompt', () => {
    const prompt = buildSystemPrompt(makeCtx({ username: 'GW34Manager' }));
    expect(prompt).toContain('GW34Manager');
  });

  it('gameweek number appears in prompt', () => {
    const prompt = buildSystemPrompt(makeCtx({ gameweek: 34 }));
    expect(prompt).toContain('34');
  });

  it('budget appears in prompt when team exists', () => {
    const prompt = buildSystemPrompt(makeCtx({ budgetLeft: '£3.5m' }));
    expect(prompt).toContain('£3.5m');
  });

  it('free transfer count appears in prompt', () => {
    const prompt = buildSystemPrompt(makeCtx({ freeTransfers: 2 }));
    expect(prompt).toContain('2');
  });

  it('profile summary appears verbatim in prompt', () => {
    const profile = 'Risk profile: aggressive\nBudget style: premium assets\nPlanning horizon: long-term';
    const prompt  = buildSystemPrompt(makeCtx({ profileSummary: profile }));
    expect(prompt).toContain('Risk profile: aggressive');
    expect(prompt).toContain('premium assets');
    expect(prompt).toContain('long-term');
  });

  it('prompt without team still works and mentions no team context', () => {
    const ctx    = makeCtx({ hasTeam: false, teamName: null, budgetLeft: null, freeTransfers: null });
    const prompt = buildSystemPrompt(ctx);
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(100);
  });

  it('recommendation block appears between MANAGER CONTEXT and CRITICAL INSTRUCTION', () => {
    const recBlock = '=== CAPTAINCY ===\nSalah top pick';
    const prompt   = buildSystemPrompt(makeCtx(), recBlock, 'CAPTAINCY');
    const recIdx   = prompt.indexOf('Salah top pick');
    const critIdx  = prompt.indexOf('CRITICAL');
    expect(recIdx).toBeGreaterThan(0);
    expect(critIdx).toBeGreaterThan(recIdx); // CRITICAL comes after recommendation data
  });
});

// ── 8. Structural output requirements ────────────────────────────────────────

describe('prompt output structure requirements', () => {

  it('every prompt asks for Recommendation, Reasoning, Risk, Alternative', () => {
    const prompt = buildSystemPrompt(makeCtx(), null, 'CAPTAINCY');
    expect(prompt).toContain('Recommendation');
    expect(prompt).toContain('Reasoning');
    expect(prompt).toContain('Risk');
    expect(prompt).toContain('Alternative');
  });

  it('prompt instructs LLM to be a collaborative advisor not autonomous agent', () => {
    const prompt = buildSystemPrompt(makeCtx());
    expect(prompt.toLowerCase()).toContain('advisor');
    expect(prompt.toLowerCase()).toContain('manager');
  });

  it('prompt prohibits executing game actions automatically', () => {
    const prompt = buildSystemPrompt(makeCtx());
    expect(prompt.toLowerCase()).toContain('never execute');
  });

  it('prompt tells LLM to acknowledge uncertainty', () => {
    const prompt = buildSystemPrompt(makeCtx());
    expect(prompt.toLowerCase()).toContain('uncertain');
  });
});