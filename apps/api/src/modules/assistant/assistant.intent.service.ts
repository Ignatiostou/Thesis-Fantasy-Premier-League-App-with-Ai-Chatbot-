// apps/api/src/modules/ai/assistant.intent.service.ts
//
// Keyword-weighted intent classifier. Two matching modes per keyword:
//   - single word  → must appear as an exact TOKEN in the message (Unicode-
//                     aware: letters/numbers only, so Greek and accented
//                     Latin text tokenize correctly). This is what makes it
//                     safe to include short, useful words like "or", "ft",
//                     "hit" — plain substring matching would also fire
//                     inside unrelated words ("bef-ore", "sc-ore", "sh-ift"),
//                     which gets more dangerous the more keywords there are.
//   - multi-word   → substring match against the normalized (punctuation-
//                     stripped) message. Safe by construction — a full
//                     phrase can't hide inside an unrelated word — and
//                     hyphen/space insensitive ("vice-captain" == "vice captain").
//
// Greek FPL users routinely mix English FPL jargon into Greek sentences
// ("κάνω transfer"), and vice versa, and may type Greek without a Greek
// keyboard (Greeklish, e.g. "kapetanios" for "καπετάνιος") or with accidental
// typos — so each intent below carries English, Greek, and (where realistic)
// Greeklish coverage, plus natural question phrasings, not just bare nouns.

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
      // English — core terms
      'captain', 'captaincy', 'armband', 'vc', 'vice captain', 'vice-captain',
      'triple captain', 'tc', '2x captain', 'double captain', 'captain armband',
      // English — natural phrasings
      'who to captain', 'who should i captain', 'who should be my captain',
      'who should be captain', 'who do i captain', 'who gets the captaincy',
      'captain pick', 'captain choice', 'captain choices', 'captain options',
      'captain advice', 'captain recommendation', 'captain recommendations',
      'captain suggestion', 'captain suggestions', 'captaincy advice',
      'best captain', 'top captain', 'safest captain', 'differential captain',
      'premium captain', 'punt captain', 'captain this week', 'captain this gw',
      'captain this gameweek', 'captain for gw', 'captain of the week',
      'who gets the armband', 'who wears the armband', 'who deserves the armband',
      'give me a captain', 'suggest a captain', 'my captain pick',
      'should i triple captain', 'who to tc', 'tc pick', 'tc this week',
      'vice captain pick', 'who should be vc', 'vc pick', 'backup captain',
      'who to give the armband to', 'captaincy decision', 'captain dilemma',
      'who should wear the armband', 'captain conundrum', 'armband decision',
      // Greek
      'αρχηγ', 'αρχηγό', 'αρχηγός', 'αρχηγία', 'αρχηγικό', 'αρχηγου', 'αρχηγο',
      'καπετάνιο', 'καπετάνιος', 'καπετάν', 'καπετανιο', 'καπετανιος',
      'αντιαρχηγ', 'αντιαρχηγός', 'αντιαρχηγό', 'αντιαρχηγο',
      'τριπλ', 'τριπλός αρχηγός', 'τριπλό αρχηγό', 'διπλοί πόντοι',
      'ποιον να κάνω αρχηγό', 'ποιον αρχηγό να βάλω', 'ποιος παίρνει το αρχηγό',
      'καλύτερος αρχηγός', 'πρόταση αρχηγού', 'περιβραχιόνιο',
      // Greeklish
      'kapetanios', 'kapetanio', 'kapetan', 'arxigos', 'arxigo', 'arxigou',
      'tripl kapetanios', 'antiarxigos',
    ],
  },
  {
    intent:  'BENCH_ORDER',
    weight:  10,
    keywords: [
      // English
      'bench', 'bench order', 'sub order', 'subs order', 'auto sub', 'autosub',
      'auto-sub', 'first sub', 'bench priority', 'bench rank', 'bench ranking',
      'who on bench', 'who to bench', 'bench positions', 'order my bench',
      'sort my bench', 'bench sequence', 'substitute order', 'substitution order',
      'who comes on first', 'first substitute', 'first man off the bench',
      'bench boost order', 'reorder bench', 'fix my bench', 'set my bench',
      'bench 12th man', '12th man', 'backup order', 'sub priority',
      'who is my first sub', 'who is my second sub', 'who is my third sub',
      'best bench order', 'optimal bench order', 'optimal sub order',
      // Greek
      'πάγκο', 'παγκο', 'πάγκ', 'παγκ', 'πάγκος', 'παγκος',
      'αντικατάστ', 'αντικαταστ', 'αντικαταστάτης', 'αντικαταστατης',
      'σειρά παγκ', 'σειρα παγκ', 'ποιος μπαίνει πρώτος', 'ποιος μπαινει πρωτος',
      'πρώτος αναπληρωματικός', 'πρωτος αναπληρωματικος',
      // Greeklish
      'pagko', 'antikatastates', 'seira pagkou',
    ],
  },
  {
    intent:  'FORMATION_ADVICE',
    weight:  10,
    keywords: [
      // English
      'formation', 'lineup', 'line-up', 'line up', 'starting xi',
      'starting eleven', 'starting 11', '442', '433', '343', '532', '352', '451',
      '4-4-2', '4-3-3', '3-4-3', '5-3-2', '3-5-2', '4-5-1',
      'who should i start', 'who to start', 'my lineup', 'my formation',
      'set my lineup', 'set my formation', 'change my formation',
      'which formation', 'what formation', 'formation advice',
      'formation suggestion', 'formation change', 'switch formation',
      'starting team', 'my starting team', 'who starts', 'who should play',
      'defensive formation', 'attacking formation', 'back three', 'back four',
      'back five', 'three at the back', 'four at the back', 'five at the back',
      // Greek
      'σύστημα', 'συστημα', 'σχηματισμ', 'σχηματισμό', 'σχηματισμος',
      'ενδεκάδα', 'ενδεκαδα', 'βασική ενδεκάδα', 'βασικη ενδεκαδα',
      'ποιοι παίζουν βασικοί', 'ποιοι παιζουν βασικοι', 'ποιο σύστημα να παίξω',
      'ποιο συστημα να παιξω', 'αλλαγή σχηματισμού', 'αλλαγη σχηματισμου',
      // Greeklish
      'sxima', 'sxhma', 'endekada', 'systima', 'systhma',
    ],
  },
  {
    // Explicit "best XI / optimal lineup" questions — narrower phrasing,
    // higher confidence, so weighted above the general formation rule.
    intent:  'FORMATION_ADVICE',
    weight:  12,
    keywords: [
      'best xi', 'best eleven', 'best 11', 'best lineup', 'best starting xi',
      'best starting eleven', 'best starting team', 'optimal lineup',
      'optimal xi', 'optimal formation', 'optimise my team', 'optimize my team',
      'optimise my lineup', 'optimize my lineup', 'best team', 'best possible xi',
      'who should i play', 'who to play', 'ideal lineup', 'ideal formation',
      'strongest xi', 'strongest lineup', 'strongest eleven',
      'καλύτερη ενδεκάδα', 'βέλτιστη ενδεκάδα', 'βελτιστη ενδεκαδα',
      'ιδανική ενδεκάδα', 'ιδανικη ενδεκαδα', 'πιο δυνατή ενδεκάδα',
    ],
  },
  {
    intent:  'CHIP_ADVICE',
    weight:  10,
    keywords: [
      // English
      'chip', 'chips', 'wildcard', 'wild card', 'bench boost', 'benchboost',
      'free hit', 'freehit', 'triple captain chip', 'play chip', 'use chip',
      'use my chip', 'use a chip', 'activate chip', 'activate my chip',
      'play my chip', 'which chip', 'what chip', 'chip strategy',
      'chip advice', 'chip timing', 'when to use wildcard', 'when to wildcard',
      'when to bench boost', 'when to free hit', 'when to triple captain',
      'should i wildcard', 'should i bench boost', 'should i free hit',
      'time to wildcard', 'time for a chip', 'save my chip', 'save my wildcard',
      'chip week', 'chip gameweek', 'blank gameweek', 'double gameweek',
      'bgw', 'dgw', 'first wildcard', 'second wildcard',
      // Greek
      'τσιπ', 'τσιπάκι', 'μπαλαντέρ', 'μπαλαντερ', 'γουάιλντ κάρντ',
      'ελεύθερη', 'ελευθερη', 'ελεύθερο χτύπημα', 'ελευθερο χτυπημα',
      'τριπλός', 'τριπλος', 'ενίσχυση πάγκου', 'ενισχυση παγκου',
      'πότε να παίξω μπαλαντέρ', 'ποτε να παιξω μπαλαντερ',
      'πότε να παίξω τσιπ', 'ποτε να παιξω τσιπ',
      // Greeklish
      'balanter', 'wildcard mou', 'freehit mou', 'benchboost mou',
    ],
  },
  {
    intent:  'PLAYER_COMPARISON',
    weight:  8,
    keywords: [
      // English
      'compare', 'comparison', 'vs', 'versus', 'better', 'or',
      'who is better', 'which is better', 'pick between', 'choose between',
      'prefer', 'which one', 'which player', 'who should i pick between',
      'head to head', 'head-to-head', 'side by side', 'side-by-side',
      'stack up against', 'how does he compare', 'how do they compare',
      'worth more than', 'better option', 'better pick', 'better choice',
      'better value', 'who edges', 'who wins between', 'a or b',
      'this or that', 'him or him', 'her or her', 'which of the two',
      // Greek
      'σύγκρινε', 'συγκρινε', 'σύγκριση', 'συγκρισ', 'σύγκρισή',
      'καλύτερ', 'καλυτερ', 'ποιος', 'ποιόν', 'ποιον',
      'ή', 'η', 'ποιον να διαλέξω', 'ποιον να διαλεξω',
      'ποιος αξίζει περισσότερο', 'ποιος αξιζει περισσοτερο',
      'ποιος είναι καλύτερος', 'ποιος ειναι καλυτερος',
      // Greeklish
      'poios einai kaluteros', 'sugkrise', 'kaluteros',
    ],
  },
  {
    intent:  'TRANSFER_EVALUATION',
    weight:  12,
    keywords: [
      // English
      'worth it', 'worth the hit', 'take the hit', 'hit worth',
      'should i take', 'is it worth', 'pay the penalty', 'take a hit',
      '-4', 'minus 4', 'minus4', 'points hit', 'point hit', 'transfer hit',
      'is it worth it', 'worth doing', 'worth the transfer', 'worth swapping',
      'should i do this transfer', 'is this transfer good', 'good transfer',
      'bad transfer', 'smart transfer', 'wise transfer', 'justify the hit',
      'is the hit worth it', 'take a -4', 'take two hits', '-8', 'minus 8',
      'evaluate this transfer', 'evaluate my transfer', 'rate this transfer',
      'assess this transfer', 'is it a good idea to transfer',
      // Greek
      'αξίζει', 'αξιζει', 'αξίζ', 'αξιζ', 'ποινή', 'ποιν', 'ποινή μεταγραφής',
      'ποινη μεταγραφης', 'αξίζει το ρίσκο', 'αξιζει το ρισκο',
      'αξίζει η ζημιά', 'αξιζει η ζημια', 'αξίζει τους πόντους',
      'αξιζει τους ποντους', 'καλή μεταγραφή', 'καλη μεταγραφη',
      'κακή μεταγραφή', 'κακη μεταγραφη',
      // Greeklish
      'aksizei', 'aksizei to risko', 'poinh metagrafis',
    ],
  },
  {
    intent:  'TRANSFER_ADVICE',
    weight:  7,
    keywords: [
      // English
      'transfer', 'transfers', 'sign', 'buy', 'sell', 'bring in',
      'get rid of', 'swap', 'replace', 'upgrade', 'downgrade',
      'free transfer', 'ft', 'who should i buy', 'who should i sell',
      'who to buy', 'who to sell', 'who to bring in', 'best transfer',
      'weak link', 'weakest', 'worst player', 'weak links', 'weak spot',
      'who should i transfer in', 'who should i transfer out', 'transfer in',
      'transfer out', 'transfer target', 'transfer targets', 'transfer suggestion',
      'transfer suggestions', 'transfer plan', 'transfer plans', 'transfer tip',
      'transfer tips', 'incoming player', 'outgoing player', 'squad upgrade',
      'improve my squad', 'improve my team', 'strengthen my squad',
      'strengthen my team', 'who should leave my team', 'drop from my squad',
      'bring into my squad', 'new signing', 'rotate out', 'move on from',
      'ditch', 'offload', 'cash in on', 'downgrade my defence',
      'upgrade my attack', 'who is not performing', 'underperforming player',
      // Greek
      'μεταγραφ', 'μεταγραφή', 'μεταγραφη', 'μεταγραφές', 'μεταγραφες',
      'φέρω', 'φερω', 'δώσω', 'δωσω', 'πουλ', 'πούλα', 'πουλα',
      'αγορ', 'αγόρασε', 'αγορασε', 'αντικαταστήσω', 'αντικαταστησω',
      'ενίσχυση', 'ενισχυση', 'αδύναμος παίκτης', 'αδυναμος παικτης',
      'ποιον να φέρω', 'ποιον να φερω', 'ποιον να πουλήσω', 'ποιον να πουλησω',
      'ποιον να αγοράσω', 'ποιον να αγορασω', 'ελεύθερη μεταγραφή',
      'ελευθερη μεταγραφη', 'πρόταση μεταγραφής', 'προταση μεταγραφης',
      // Greeklish
      'metagrafi', 'metagrafes', 'agora paikti', 'poulisi paikti',
    ],
  },
  {
    intent:  'INITIAL_SQUAD',
    weight:  10,
    keywords: [
      // English
      'initial squad', 'build my team', 'build my squad', 'starting team',
      'first squad', 'help me build', 'help me pick', 'help me choose',
      'help me create', 'help me put together', 'help me form', 'help me draft',
      'draft', '15 players', '15-man', '15 man squad', 'brand new squad',
      'new to fpl', 'new to fantasy', 'just starting', 'just started fpl',
      'my first team', 'my first squad', 'starting squad', 'from scratch',
      'build a team', 'build a squad', 'pick my squad', 'pick my team',
      'choose my squad', 'choose my team', 'create my squad', 'create my team',
      'put together a squad', 'put together a team', 'whole squad',
      'entire squad', 'entire team', 'full squad', 'full team', 'squad from zero',
      'starting from zero', 'suggest a squad', 'suggest a team',
      'suggest players for my squad', 'suggest players for my team',
      'recommend a squad', 'recommend a team', 'recommend players for my squad',
      'give me a squad', 'give me a team', 'squad suggestions', 'team suggestions',
      'squad builder', 'team builder', 'draft my squad', 'draft my team',
      // Greek
      '15άδα', '15αδα', 'αρχικ', 'αρχική ομάδα', 'αρχικη ομαδα',
      'φτιάξω', 'φτιαξω', 'φτιάξε μου ομάδα', 'φτιαξε μου ομαδα',
      'βοήθησέ με να φτιάξω', 'βοηθησε με να φτιαξω', 'πρώτη ομάδα',
      'πρωτη ομαδα', 'καινούρια ομάδα', 'καινουρια ομαδα', 'νέος στο fpl',
      'νεος στο fpl', 'φτιάξε μου την ομάδα μου', 'πρόταση ομάδας',
      'προταση ομαδας', 'χτίσε μου ομάδα', 'χτισε μου ομαδα',
      // Greeklish
      'ftiakse mou omada', 'arxiki omada', 'neos sto fpl',
    ],
  },
  {
    intent:  'ONBOARDING',
    weight:  10,
    keywords: [
      // English
      'onboarding', 'profile', 'set up', 'setup', 'preferences',
      'my style', 'my strategy', 'my playing style', 'risk tolerance',
      'update my profile', 'change my profile', 'edit my profile',
      'change my preferences', 'update my preferences', 'my settings',
      'change my settings', 'personalise', 'personalize', 'tell you about me',
      'about my preferences', 'how i play', 'my approach',
      // Greek
      'προφίλ', 'προφιλ', 'ρυθμίσεις', 'ρυθμισεις', 'στυλ παιχνιδιού',
      'στυλ παιχνιδιου', 'προτιμήσεις', 'προτιμησεις', 'άλλαξε το προφίλ μου',
      'αλλαξε το προφιλ μου',
      // Greeklish
      'profil mou', 'ruthmiseis',
    ],
  },
];

// ── Shared normalization ──────────────────────────────────────────────────────
//
// Unicode-aware: \p{L}/\p{N} correctly include Greek and accented Latin
// letters (plain \w does not). Both the message and every keyword are run
// through the same normalization, so hyphens/punctuation differences (e.g.
// "vice-captain" vs "vice captain") never cause a missed match.

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function computeScores(message: string): Map<AssistantIntent, number> {
  const normalizedMessage = normalize(message);
  const tokens = new Set(normalizedMessage.split(' ').filter(Boolean));
  const scores = new Map<AssistantIntent, number>();

  for (const rule of INTENT_RULES) {
    for (const kw of rule.keywords) {
      const normKw = normalize(kw);
      if (!normKw) continue;

      const matched = normKw.includes(' ')
        ? normalizedMessage.includes(normKw)   // phrase — substring match
        : tokens.has(normKw);                  // single word — exact token match

      if (matched) {
        scores.set(rule.intent, (scores.get(rule.intent) ?? 0) + rule.weight);
      }
    }
  }

  return scores;
}

export function detectAssistantIntent(message: string): AssistantIntent {
  const scores = computeScores(message);
  if (scores.size === 0) return 'GENERAL_HELP';

  let best: AssistantIntent = 'GENERAL_HELP';
  let bestScore = 0;
  for (const [intent, score] of scores) {
    if (score > bestScore) { bestScore = score; best = intent; }
  }
  return best;
}

// ── Scope gate ────────────────────────────────────────────────────────────────
//
// The system prompt asks the model to stay on Fantasy Premier League topics,
// but a prompt is a request to a probabilistic system, not a constraint on it:
// asked for the capital of France plus a Python script, the assistant supplied
// both. The boundary therefore lives here, in code, where it is deterministic
// and testable, instead of in the prompt.
//
// A message is in scope if it matches any intent above, OR if it contains any
// general football/FPL vocabulary. The second test matters because plenty of
// legitimate questions ("analyse my squad", "how does scoring work?") match no
// intent keyword and correctly fall through to GENERAL_HELP — refusing on
// "no intent matched" alone would break them.

const FPL_VOCABULARY = [
  // the game itself
  'fpl', 'fantasy', 'premier league', 'gameweek', 'gw', 'deadline', 'season',
  'manager', 'mini league', 'league', 'rank', 'chip', 'wildcard', 'bench boost',
  'free hit', 'triple captain', 'points', 'point', 'score', 'scoring', 'haul',
  // squad and players
  'squad', 'team', 'player', 'players', 'lineup', 'bench', 'captain', 'formation',
  'transfer', 'budget', 'price', 'value', 'ownership', 'differential', 'template',
  'goalkeeper', 'keeper', 'defender', 'midfielder', 'forward', 'striker',
  'gk', 'def', 'mid', 'fwd',
  // performance
  'goal', 'goals', 'assist', 'assists', 'clean sheet', 'minutes', 'form',
  'injury', 'injured', 'fit', 'fitness', 'suspended', 'rotation', 'started',
  'fixture', 'fixtures', 'opponent', 'home', 'away', 'difficulty', 'fdr',
  'xg', 'xa', 'expected points', 'xpts', 'bonus', 'bps',
  // Greek
  'ομάδα', 'ομαδα', 'παίκτ', 'παικτ', 'βαθμολογ', 'πόντ', 'ποντ',
  'αγωνιστικ', 'μεταγραφ', 'αρχηγ', 'πάγκο', 'παγκο', 'τραυματ',
  'γκολ', 'ασίστ', 'ασιστ', 'σύστημα', 'συστημα', 'πρωτάθλημα', 'πρωταθλημα',
  'σέντερ', 'αμυντικ', 'μέσος', 'μεσος', 'επιθετικ', 'τερματοφύλακ', 'τερματοφυλακ',
];

export function isFplRelated(message: string): boolean {
  if (computeScores(message).size > 0) return true;

  const normalized = normalize(message);
  const tokens = new Set(normalized.split(' ').filter(Boolean));

  return FPL_VOCABULARY.some((term) => {
    const normTerm = normalize(term);
    if (!normTerm) return false;
    if (normTerm.includes(' ')) return normalized.includes(normTerm);
    // Greek stems above are deliberately truncated ('παίκτ'), so they need a
    // prefix match rather than an exact token match.
    if (/[Ͱ-Ͽ]/.test(normTerm)) return normalized.includes(normTerm);
    return tokens.has(normTerm);
  });
}

export const OUT_OF_SCOPE_REPLY =
  "I'm your Fantasy Premier League coach, so I can only help with FPL and " +
  'Premier League football — squad selection, captaincy, transfers, chips, ' +
  'fixtures, and player analysis.\n\n' +
  'Ask me something like "who should I captain this week?", "suggest a ' +
  'transfer for me", or "analyse my squad" and I\'ll take a look.';

export function getIntentConfidence(message: string): {
  intent:     AssistantIntent;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  scores:     Record<string, number>;
} {
  const scores  = computeScores(message);
  const intent  = detectAssistantIntent(message);
  const topScore = scores.get(intent) ?? 0;

  return {
    intent,
    confidence: topScore >= 20 ? 'HIGH' : topScore >= 10 ? 'MEDIUM' : 'LOW',
    scores:     Object.fromEntries(scores),
  };
}
