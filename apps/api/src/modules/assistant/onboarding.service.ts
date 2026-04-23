import { prisma } from '../../db/prisma.js';
import { ONBOARDING_QUESTIONS } from './onboarding.questions.js';
import type { CompleteOnboardingInput } from '@fpl/types';

export interface OnboardingAnswers extends CompleteOnboardingInput {}

function isOneToThree(value: number) {
  return value === 1 || value === 2 || value === 3;
}

function parseNotes(notes: unknown): Record<string, unknown> {
  if (!notes) return {};

  if (typeof notes === 'string') {
    try {
      return JSON.parse(notes);
    } catch {
      return {};
    }
  }

  if (typeof notes === 'object' && notes !== null) {
    return notes as Record<string, unknown>;
  }

  return {};
}

function stringifyNotes(notes: Record<string, unknown>) {
  return JSON.stringify(notes);
}

export function getOnboardingQuestions() {
  return ONBOARDING_QUESTIONS;
}

export async function getAssistantProfile(userId: string) {
  return prisma.userAssistantProfile.findUnique({
    where: { userId },
  });
}

export async function saveOnboardingAnswers(
  userId: string,
  answers: OnboardingAnswers,
) {
  const fields = Object.entries(answers);
  for (const [key, val] of fields) {
    if (!isOneToThree(val)) {
      throw new Error(`INVALID_ANSWER_VALUE: ${key} must be 1, 2, or 3`);
    }
  }

  const extraNotes = {
    topSixAffinity: answers.topSixAffinity,
    captaincyStyle: answers.captaincyStyle,
    transferFrequency: answers.transferFrequency,
    fixtureAwareness: answers.fixtureAwareness,
  };

  const profile = await prisma.userAssistantProfile.upsert({
    where: { userId },
    create: {
      userId,
      riskTolerance: answers.riskTolerance,
      budgetStyle: answers.budgetStyle,
      preferredFocus: answers.preferredFocus,
      differentialPreference: answers.differentialPreference,
      planningHorizon: answers.planningHorizon,
      explanationDepth: answers.explanationDepth,
      notes: stringifyNotes(extraNotes),
      onboardingCompleted: true,
      onboardingStep: 10,
    },
    update: {
      riskTolerance: answers.riskTolerance,
      budgetStyle: answers.budgetStyle,
      preferredFocus: answers.preferredFocus,
      differentialPreference: answers.differentialPreference,
      planningHorizon: answers.planningHorizon,
      explanationDepth: answers.explanationDepth,
      notes: stringifyNotes(extraNotes),
      onboardingCompleted: true,
      onboardingStep: 10,
    },
  });

  return profile;
}

export async function saveOnboardingStep(
  userId: string,
  step: number,
  questionId: string,
  value: number,
) {
  if (!isOneToThree(value)) throw new Error('INVALID_ANSWER_VALUE');

  const coreFields: Record<string, string> = {
    riskTolerance: 'riskTolerance',
    budgetStyle: 'budgetStyle',
    preferredFocus: 'preferredFocus',
    differentialPreference: 'differentialPreference',
    planningHorizon: 'planningHorizon',
    explanationDepth: 'explanationDepth',
  };

  const existing = await prisma.userAssistantProfile.findUnique({
    where: { userId },
  });

  if (coreFields[questionId]) {
    await prisma.userAssistantProfile.upsert({
      where: { userId },
      create: {
        userId,
        [coreFields[questionId]]: value,
        onboardingStep: step,
        onboardingCompleted: false,
      },
      update: {
        [coreFields[questionId]]: value,
        onboardingStep: step,
      },
    });
  } else {
    const currentNotes = parseNotes(existing?.notes);
    const updatedNotes = { ...currentNotes, [questionId]: value };

    await prisma.userAssistantProfile.upsert({
      where: { userId },
      create: {
        userId,
        notes: stringifyNotes(updatedNotes),
        onboardingStep: step,
        onboardingCompleted: false,
      },
      update: {
        notes: stringifyNotes(updatedNotes),
        onboardingStep: step,
      },
    });
  }

  return { step, saved: true };
}

export function buildProfileSummary(profile: {
  riskTolerance: number;
  budgetStyle: number;
  preferredFocus: number;
  differentialPreference: number;
  planningHorizon: number;
  explanationDepth: number;
  notes?: unknown;
}): string {
  const risk = ['low-risk / conservative', 'balanced', 'high-risk / aggressive'];
  const budget = ['value-oriented (cheap overperformers)', 'balanced budget', 'premium assets'];
  const focus = ['defensive (clean sheets & bonus)', 'midfield-heavy', 'attack-focused'];
  const diff = ['safe high-ownership picks', 'occasionally differential', 'loves differentials'];
  const plan = ['short-term fixture exploiter', 'balanced horizon', 'long-term squad stability'];
  const depth = ['brief', 'medium detail', 'highly detailed'];

  const extra = parseNotes(profile.notes);

  const captaincy = typeof extra.captaincyStyle === 'number'
    ? ['safe armband favourite', 'balanced captaincy', 'bold differential captain'][extra.captaincyStyle - 1]
    : 'balanced';

  const transfers = typeof extra.transferFrequency === 'number'
    ? ['rolls transfers often', 'uses 1 transfer per week', 'active — willing to take hits'][extra.transferFrequency - 1]
    : 'balanced';

  const fixtures = typeof extra.fixtureAwareness === 'number'
    ? ['ignores fixtures', 'considers fixtures somewhat', 'obsessed with fixture difficulty'][extra.fixtureAwareness - 1]
    : 'balanced';

  const bigSix = typeof extra.topSixAffinity === 'number'
    ? ['avoids Big Six', 'no Big Six preference', 'prefers Big Six assets'][extra.topSixAffinity - 1]
    : 'no preference';

  return [
    `Risk profile: ${risk[profile.riskTolerance - 1]}`,
    `Budget style: ${budget[profile.budgetStyle - 1]}`,
    `Pitch focus: ${focus[profile.preferredFocus - 1]}`,
    `Differential appetite: ${diff[profile.differentialPreference - 1]}`,
    `Planning horizon: ${plan[profile.planningHorizon - 1]}`,
    `Explanation preference: ${depth[profile.explanationDepth - 1]} explanations`,
    `Captaincy style: ${captaincy}`,
    `Transfer frequency: ${transfers}`,
    `Fixture awareness: ${fixtures}`,
    `Big Six affinity: ${bigSix}`,
  ].join('\n');
}