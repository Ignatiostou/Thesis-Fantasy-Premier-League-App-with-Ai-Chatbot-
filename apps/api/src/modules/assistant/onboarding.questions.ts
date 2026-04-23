import type { OnboardingQuestion,OnboardingOption} from '@fpl/types';

export const ONBOARDING_QUESTIONS: OnboardingQuestion[] = [
  {
    id: 'riskTolerance',
    step: 1,
    question: "What's your main goal this season?",
    subtext: 'This shapes how aggressive or safe your recommendations will be.',
    options: [
      { label: '🛡️ Stay consistent, avoid big swings', value: 1 },
      { label: '⚖️ Balance points with some risk', value: 2 },
      { label: '🚀 Chase big scores, high variance', value: 3 },
    ],
  },
  {
    id: 'budgetStyle',
    step: 2,
    question: 'How do you like to spend your budget?',
    subtext: 'Premium = top assets. Value = cheap enablers who overperform.',
    options: [
      { label: '💰 Value picks — cheap players who deliver', value: 1 },
      { label: '⚖️ Mix of premium and value', value: 2 },
      { label: '⭐ Premium assets — I want the best', value: 3 },
    ],
  },
  {
    id: 'preferredFocus',
    step: 3,
    question: 'Which area of the pitch do you prioritise?',
    subtext: 'Affects how your budget and transfers are distributed.',
    options: [
      { label: '🧱 Defence — clean sheets & bonus', value: 1 },
      { label: '🎯 Midfield — the points engine', value: 2 },
      { label: '⚽ Attack — goals win leagues', value: 3 },
    ],
  },
  {
    id: 'differentialPreference',
    step: 4,
    question: 'How do you feel about differential picks?',
    subtext: 'Differentials = low-ownership players that can rocket your rank.',
    options: [
      { label: '✅ Safe — high-ownership reliable picks', value: 1 },
      { label: '🔀 Occasionally take a differential', value: 2 },
      { label: '📈 Love differentials to beat my league', value: 3 },
    ],
  },
  {
    id: 'planningHorizon',
    step: 5,
    question: 'Are you a short-term or long-term planner?',
    subtext: 'Affects whether I suggest fixture-chasing or squad stability.',
    options: [
      { label: '📅 Short-term — exploit the next 2-3 GWs', value: 1 },
      { label: '⚖️ Balance both horizons', value: 2 },
      { label: '🗓️ Long-term — build a stable squad', value: 3 },
    ],
  },
  {
    id: 'explanationDepth',
    step: 6,
    question: 'How detailed do you want my explanations?',
    subtext: "I'll adjust how much I say based on your preference.",
    options: [
      { label: '⚡ Short — just the key recommendation', value: 1 },
      { label: '📋 Medium — recommendation + key reasons', value: 2 },
      { label: '📚 Detailed — full analysis with trade-offs', value: 3 },
    ],
  },
  {
    id: 'topSixAffinity',
    step: 7,
    question: 'How do you feel about players from the "Big Six"?',
    subtext: 'Man City, Arsenal, Chelsea, Liverpool, Man Utd, Spurs.',
    options: [
      { label: '🏆 Love them — always look at Big Six first', value: 3 },
      { label: '⚖️ No preference — best player wins', value: 2 },
      { label: '🔍 Prefer under-the-radar clubs', value: 1 },
    ],
  },
  {
    id: 'captaincyStyle',
    step: 8,
    question: 'What is your captaincy style?',
    subtext: 'The captain gets double points — a crucial weekly decision.',
    options: [
      { label: '🔒 Safe — always captain the armband favourite', value: 1 },
      { label: '⚖️ Sometimes take a punt on a strong fixture', value: 2 },
      { label: '🎲 Bold — differential captain for big swings', value: 3 },
    ],
  },
  {
    id: 'transferFrequency',
    step: 9,
    question: 'How actively do you transfer?',
    subtext: 'Affects whether I suggest rolling transfers or using them each week.',
    options: [
      { label: '🏦 Roll transfers — save free transfers often', value: 1 },
      { label: '⚖️ Use 1 transfer most weeks', value: 2 },
      { label: '🔄 Active — sometimes take hits for the right move', value: 3 },
    ],
  },
  {
    id: 'fixtureAwareness',
    step: 10,
    question: 'How much do fixtures influence your decisions?',
    subtext: 'Easy fixtures = more attacking returns. Hard = defensive caution.',
    options: [
      { label: '📊 I always check fixture difficulty first', value: 3 },
      { label: '⚖️ I consider fixtures but not obsessively', value: 2 },
      { label: '👤 I pick on player quality, not fixtures', value: 1 },
    ],
  },
];

export function getOnboardingQuestions(): OnboardingQuestion[] {
  return ONBOARDING_QUESTIONS;
}