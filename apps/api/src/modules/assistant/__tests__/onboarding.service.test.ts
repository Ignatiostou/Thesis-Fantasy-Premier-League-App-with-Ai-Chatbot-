import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db/prisma.js', () => ({
  prisma: {
    userAssistantProfile: {
      findUnique: vi.fn(),
      upsert:     vi.fn(),
    },
  },
}));

import { prisma } from '../../../db/prisma.js';
import {
  buildProfileSummary,
  getOnboardingQuestions,
  saveOnboardingAnswers,
  saveOnboardingStep,
} from '../onboarding.service.js';

const mock = prisma as any;

// ── buildProfileSummary ───────────────────────────────────────────────────────

describe('buildProfileSummary', () => {

  const fullProfile = {
    riskTolerance:          2,
    budgetStyle:            2,
    preferredFocus:         2,
    differentialPreference: 2,
    planningHorizon:        2,
    explanationDepth:       2,
    notes: JSON.stringify({
      topSixAffinity:    2,
      captaincyStyle:    2,
      transferFrequency: 2,
      fixtureAwareness:  2,
    }),
  };

  it('returns a non-empty string', () => {
    expect(buildProfileSummary(fullProfile).length).toBeGreaterThan(0);
  });

  it('includes all key sections', () => {
    const s = buildProfileSummary(fullProfile);
    expect(s).toContain('Risk profile:');
    expect(s).toContain('Budget style:');
    expect(s).toContain('Pitch focus:');
    expect(s).toContain('Differential appetite:');
    expect(s).toContain('Planning horizon:');
    expect(s).toContain('Explanation preference:');
  });

  it('describes riskTolerance=1 as conservative', () => {
    expect(buildProfileSummary({ ...fullProfile, riskTolerance: 1 })).toContain('conservative');
  });

  it('describes riskTolerance=3 as aggressive', () => {
    expect(buildProfileSummary({ ...fullProfile, riskTolerance: 3 })).toContain('aggressive');
  });

  it('describes explanationDepth=1 as brief', () => {
    expect(buildProfileSummary({ ...fullProfile, explanationDepth: 1 })).toContain('brief');
  });

  it('describes explanationDepth=3 as highly detailed', () => {
    expect(buildProfileSummary({ ...fullProfile, explanationDepth: 3 })).toContain('highly detailed');
  });

  it('describes budgetStyle=1 as value-oriented', () => {
    expect(buildProfileSummary({ ...fullProfile, budgetStyle: 1 })).toContain('value-oriented');
  });

  it('describes budgetStyle=3 as premium', () => {
    expect(buildProfileSummary({ ...fullProfile, budgetStyle: 3 })).toContain('premium');
  });

  it('describes planningHorizon=1 as short-term', () => {
    expect(buildProfileSummary({ ...fullProfile, planningHorizon: 1 })).toContain('short-term');
  });

  it('describes planningHorizon=3 as long-term', () => {
    expect(buildProfileSummary({ ...fullProfile, planningHorizon: 3 })).toContain('long-term');
  });

  it('handles missing notes gracefully without crashing', () => {
    expect(() => buildProfileSummary({ ...fullProfile, notes: undefined })).not.toThrow();
    expect(() => buildProfileSummary({ ...fullProfile, notes: null })).not.toThrow();
    expect(() => buildProfileSummary({ ...fullProfile, notes: 'invalid{' })).not.toThrow();
  });

  it('produces different summaries for different profiles', () => {
    const a = buildProfileSummary({ ...fullProfile, riskTolerance: 1 });
    const b = buildProfileSummary({ ...fullProfile, riskTolerance: 3 });
    expect(a).not.toBe(b);
  });
});

// ── getOnboardingQuestions ────────────────────────────────────────────────────

describe('getOnboardingQuestions', () => {

  it('returns an array of questions', () => {
    expect(Array.isArray(getOnboardingQuestions())).toBe(true);
  });

  it('returns exactly 10 questions', () => {
    expect(getOnboardingQuestions()).toHaveLength(10);
  });

  // Fix: actual shape is { id, step, question, subtext, options }
  it('each question has id, question field, and options array', () => {
    for (const q of getOnboardingQuestions()) {
      expect(q).toHaveProperty('id');
      expect(q).toHaveProperty('question');  // ← 'question' not 'text'
      expect(q).toHaveProperty('options');
      expect(Array.isArray(q.options)).toBe(true);
    }
  });

  it('each question has exactly 3 options', () => {
    for (const q of getOnboardingQuestions()) {
      expect(q.options).toHaveLength(3);
    }
  });

  // Fix: option shape is { label, value } — values are 1, 2, 3
  it('option values are 1, 2, 3', () => {
    for (const q of getOnboardingQuestions()) {
      const values = q.options.map((o: any) => o.value).sort();
      expect(values).toEqual([1, 2, 3]);
    }
  });

  it('all question ids are unique', () => {
    const ids = getOnboardingQuestions().map((q: any) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each option has a label string', () => {
    for (const q of getOnboardingQuestions()) {
      for (const o of q.options) {
        expect(typeof o.label).toBe('string');
        expect(o.label.length).toBeGreaterThan(0);
      }
    }
  });
});

// ── saveOnboardingAnswers ─────────────────────────────────────────────────────

describe('saveOnboardingAnswers', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    mock.userAssistantProfile.upsert.mockResolvedValue({ id: 'p1', onboardingCompleted: true, onboardingStep: 10 });
  });

  const validAnswers = {
    riskTolerance: 2 as const, budgetStyle: 2 as const, preferredFocus: 2 as const,
    differentialPreference: 2 as const, planningHorizon: 2 as const, explanationDepth: 2 as const,
    topSixAffinity: 2 as const, captaincyStyle: 2 as const, transferFrequency: 2 as const,
    fixtureAwareness: 2 as const,
  };

  it('upserts the profile with correct userId', async () => {
    await saveOnboardingAnswers('user_1', validAnswers);
    expect(mock.userAssistantProfile.upsert).toHaveBeenCalledOnce();
    expect(mock.userAssistantProfile.upsert.mock.calls[0][0].where.userId).toBe('user_1');
  });

  it('throws INVALID_ANSWER_VALUE for value out of range (4)', async () => {
    await expect(saveOnboardingAnswers('user_1', { ...validAnswers, riskTolerance: 4 as any }))
      .rejects.toThrow('INVALID_ANSWER_VALUE');
    expect(mock.userAssistantProfile.upsert).not.toHaveBeenCalled();
  });

  it('throws INVALID_ANSWER_VALUE for value 0', async () => {
    await expect(saveOnboardingAnswers('user_1', { ...validAnswers, budgetStyle: 0 as any }))
      .rejects.toThrow('INVALID_ANSWER_VALUE');
  });

  it('marks onboardingCompleted as true', async () => {
    await saveOnboardingAnswers('user_1', validAnswers);
    const call = mock.userAssistantProfile.upsert.mock.calls[0][0];
    const completed = call.create?.onboardingCompleted ?? call.update?.onboardingCompleted;
    expect(completed).toBe(true);
  });
});

// ── saveOnboardingStep ────────────────────────────────────────────────────────

describe('saveOnboardingStep', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    mock.userAssistantProfile.findUnique.mockResolvedValue(null);
    mock.userAssistantProfile.upsert.mockResolvedValue({ id: 'p1' });
  });

  it('saves a valid step without throwing', async () => {
    await expect(saveOnboardingStep('user_1', 1, 'riskTolerance', 2)).resolves.not.toThrow();
  });

  it('throws INVALID_ANSWER_VALUE for value 0', async () => {
    await expect(saveOnboardingStep('user_1', 1, 'riskTolerance', 0))
      .rejects.toThrow('INVALID_ANSWER_VALUE');
  });

  it('throws INVALID_ANSWER_VALUE for value 4', async () => {
    await expect(saveOnboardingStep('user_1', 1, 'riskTolerance', 4))
      .rejects.toThrow('INVALID_ANSWER_VALUE');
  });

  it('upserts profile with the correct field value for a core field', async () => {
    await saveOnboardingStep('user_1', 1, 'riskTolerance', 3);
    expect(mock.userAssistantProfile.upsert).toHaveBeenCalled();
    const call = mock.userAssistantProfile.upsert.mock.calls[0][0];
    const val = call.create?.riskTolerance ?? call.update?.riskTolerance;
    expect(val).toBe(3);
  });

  it('handles extra (notes) fields without crashing', async () => {
    await expect(saveOnboardingStep('user_1', 7, 'topSixAffinity', 1)).resolves.not.toThrow();
  });
});