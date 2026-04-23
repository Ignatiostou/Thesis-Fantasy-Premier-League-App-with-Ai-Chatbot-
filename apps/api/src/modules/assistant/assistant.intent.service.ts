// apps/api/src/modules/ai/assistant.intent.service.ts
// Updated for Phase 5: added LINEUP_ADVICE intent.

import type { AssistantIntent } from '@fpl/types';

const INTENT_RULES: Array<{
  intent:   AssistantIntent;
  weight:   number;
  keywords: string[];
}> = [
  {
    intent:  'CAPTAINCY',
    weight:  10,
    keywords: [
      'captain', 'captaincy', 'armband', 'vc', 'vice captain', 'vice-captain',
      'triple captain', 'tc',
      'αρχηγ', 'αρχηγό', 'αρχηγος', 'καπτεν', 'αντιαρχηγ', 'τριπλ',
    ],
  },
  {
    intent:  'BENCH_ORDER',
    weight:  10,
    keywords: [
      'bench', 'bench order', 'sub order', 'auto sub', 'first sub',
      'bench priority', 'bench rank', 'who on bench',
      'πάγκο', 'παγκο', 'πάγκ', 'παγκ', 'αντικατάστ', 'αντικαταστ',
    ],
  },
  {
    intent:  'FORMATION_ADVICE',
    weight:  10,
    keywords: [
      'formation', 'lineup', 'line-up', 'line up', 'starting xi',
      'starting eleven', '442', '433', '343', '532', '352', '541', '451',
      'who should i start', 'who to start', 'my lineup', 'my formation',
      'σύστημα', 'συστημα', 'σχηματισμ', 'ενδεκάδα', 'ενδεκαδα',
    ],
  },
  {
    // NEW Phase 5 intent — explicit "best XI / optimal lineup" questions
    intent:  'FORMATION_ADVICE',   // maps to FORMATION_ADVICE for now — covers lineup optimizer too
    weight:  12,
    keywords: [
      'best xi', 'best eleven', 'best lineup', 'best starting',
      'optimal lineup', 'optimal xi', 'optimise my team', 'optimize my team',
      'best team', 'who should i play', 'who to play',
      'καλύτερη ενδεκάδα', 'βέλτιστη ενδεκάδα',
    ],
  },
  {
    intent:  'CHIP_ADVICE',
    weight:  10,
    keywords: [
      'chip', 'wildcard', 'wild card', 'bench boost', 'free hit',
      'triple captain', 'play chip', 'use chip', 'activate chip',
      'τσιπ', 'ελεύθερη', 'ελευθερη', 'τριπλός', 'τριπλος',
    ],
  },
  {
    intent:  'PLAYER_COMPARISON',
    weight:  8,
    keywords: [
      'compare', 'comparison', 'vs', 'versus', 'better',
      'who is better', 'pick between', 'choose between', 'prefer',
      'which one', 'which player', 'or',
      'σύγκρινε', 'συγκρινε', 'σύγκριση', 'συγκρισ',
      'καλύτερ', 'καλυτερ', 'ποιος', 'ποιόν',
    ],
  },
  {
    intent:  'TRANSFER_EVALUATION',
    weight:  12,
    keywords: [
      'worth it', 'worth the hit', 'take the hit', 'hit worth',
      'should i take', 'is it worth', 'pay the penalty', 'take a hit',
      '-4', 'minus 4', 'points hit',
      'αξίζει', 'αξιζει', 'αξίζ', 'αξιζ', 'ποινή', 'ποιν',
    ],
  },
  {
    intent:  'TRANSFER_ADVICE',
    weight:  7,
    keywords: [
      'transfer', 'transfers', 'sign', 'buy', 'sell', 'bring in',
      'get rid of', 'swap', 'replace', 'upgrade', 'downgrade',
      'free transfer', 'ft', 'who should i buy', 'who should i sell',
      'who to buy', 'who to sell', 'who to bring in', 'best transfer',
      'weak link', 'weakest', 'worst player',
      'μεταγραφ', 'φέρω', 'φερω', 'δώσω', 'δωσω', 'πουλ', 'αγορ',
      'αντικαταστήσω',
    ],
  },
  {
    intent:  'INITIAL_SQUAD',
    weight:  10,
    keywords: [
      'initial squad', 'build my team', 'starting team', 'first squad',
      'help me build', 'help me pick', 'draft', '15 players', '15-man',
      '15άδα', '15αδα', 'αρχικ', 'φτιάξω', 'φτιαξω',
    ],
  },
  {
    intent:  'ONBOARDING',
    weight:  10,
    keywords: [
      'onboarding', 'profile', 'set up', 'setup', 'preferences',
      'my style', 'my strategy',
      'προφίλ', 'προφιλ', 'ρυθμίσεις', 'ρυθμισεις',
    ],
  },
];

export function detectAssistantIntent(message: string): AssistantIntent {
  const lower  = message.toLowerCase();
  const scores = new Map<AssistantIntent, number>();

  for (const rule of INTENT_RULES) {
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) {
        const current = scores.get(rule.intent) ?? 0;
        scores.set(rule.intent, current + rule.weight);
      }
    }
  }

  if (scores.size === 0) return 'GENERAL_HELP';

  let best: AssistantIntent = 'GENERAL_HELP';
  let bestScore = 0;
  for (const [intent, score] of scores) {
    if (score > bestScore) { bestScore = score; best = intent; }
  }
  return best;
}

export function getIntentConfidence(message: string): {
  intent:     AssistantIntent;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  scores:     Record<string, number>;
} {
  const lower  = message.toLowerCase();
  const scores = new Map<AssistantIntent, number>();

  for (const rule of INTENT_RULES) {
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) {
        const current = scores.get(rule.intent) ?? 0;
        scores.set(rule.intent, current + rule.weight);
      }
    }
  }

  const intent   = detectAssistantIntent(message);
  const topScore = scores.get(intent) ?? 0;

  return {
    intent,
    confidence: topScore >= 20 ? 'HIGH' : topScore >= 10 ? 'MEDIUM' : 'LOW',
    scores:     Object.fromEntries(scores),
  };
}