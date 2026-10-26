import { it, expect, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { detectAssistantIntent, isFplRelated } from '../assistant.intent.service.js';
vi.mock('../../../db/prisma.js', () => ({ prisma: { assistantMessage: { findMany: vi.fn() } } }));
import { prisma } from '../../../db/prisma.js';
import { getRecentHistory } from '../assistant.memory.service.js';

const out = resolve('../../output/evaluation-day10');
const cases: Array<[string, string, string, boolean]> = [
  ['captain', 'Who gets the armband this gameweek?', 'CAPTAINCY', true],
  ['captain', 'Give me a safe captain for my squad.', 'CAPTAINCY', true],
  ['captain', 'Ποιον να κάνω αρχηγό;', 'CAPTAINCY', true],
  ['formation', 'Which formation should I use?', 'FORMATION_ADVICE', true],
  ['formation', 'Select my starting eleven.', 'FORMATION_ADVICE', true],
  ['formation', 'Θέλω αμυντικό σύστημα.', 'FORMATION_ADVICE', true],
  ['bench', 'Order my bench for this week.', 'BENCH_ORDER', true],
  ['bench', 'Who comes on first?', 'BENCH_ORDER', true],
  ['transfer', 'Suggest a transfer within my budget.', 'TRANSFER_ADVICE', true],
  ['transfer', 'Replace my injured defender.', 'TRANSFER_ADVICE', true],
  ['transfer', 'Ποιον να αγοράσω για την ομάδα μου;', 'TRANSFER_ADVICE', true],
  ['hit', 'Is this transfer worth the hit?', 'TRANSFER_EVALUATION', true],
  ['hit', 'Should I take a -4 to replace my midfielder?', 'TRANSFER_EVALUATION', true],
  ['comparison', 'Compare Saka and Palmer.', 'PLAYER_COMPARISON', true],
  ['comparison', 'Salah versus Haaland for my squad?', 'PLAYER_COMPARISON', true],
  ['chip', 'Should I use my wildcard?', 'CHIP_ADVICE', true],
  ['chip', 'When should I play bench boost?', 'CHIP_ADVICE', true],
  ['chip', 'When should I use my triple captain chip?', 'CHIP_ADVICE', true],
  ['initial', 'Build my initial squad.', 'INITIAL_SQUAD', true],
  ['initial', 'Suggest a team from scratch.', 'INITIAL_SQUAD', true],
  ['profile', 'Change my risk tolerance.', 'ONBOARDING', true],
  ['profile', 'Update my preferences.', 'ONBOARDING', true],
  ['general', 'Explain how FPL scoring works.', 'GENERAL_HELP', true],
  ['general', 'When is the gameweek deadline?', 'GENERAL_HELP', true],
  ['offtopic', 'Write a chocolate cake recipe.', 'GENERAL_HELP', false],
  ['offtopic', 'What is the capital of France?', 'GENERAL_HELP', false],
  ['offtopic', 'Compare two laptop brands.', 'GENERAL_HELP', false],
  ['offtopic', 'Should I buy a bicycle?', 'GENERAL_HELP', false],
  ['offtopic', 'Help me transfer files to a new computer.', 'GENERAL_HELP', false],
  ['offtopic', 'How do I improve my credit score?', 'GENERAL_HELP', false],
  ['followup', 'Why that one?', 'CONTEXT_REQUIRED', true],
  ['followup', 'Explain your previous answer.', 'CONTEXT_REQUIRED', true],
  ['followup', 'No, I meant the other one.', 'CONTEXT_REQUIRED', true],
  ['followup', 'What if I only have 0.5 left?', 'CONTEXT_REQUIRED', true],
];

it('records a frozen diagnostic corpus without treating known failures as successes', () => {
  mkdirSync(out, { recursive: true });
  const rows = cases.map(([category, message, expectedIntent, expectedScope], i) => ({
    id: i + 1, category, message, expectedIntent, expectedScope,
    intent: detectAssistantIntent(message), scope: isFplRelated(message),
  }));
  writeFileSync(resolve(out, 'routing.json'), JSON.stringify({
    description: 'Author-labelled diagnostic corpus; not a held-out population benchmark. Follow-ups assume an earlier FPL exchange. Scope tests exclude the database player-name fallback.', rows,
  }, null, 2));
  expect(rows).toHaveLength(34);
});

it('characterises which messages reach generation after a long conversation', async () => {
  const transcript = Array.from({ length: 25 }, (_, i) => ({
    role: i % 2 ? 'ASSISTANT' : 'USER', content: `turn-${i + 1}`,
  }));
  (prisma.assistantMessage.findMany as any).mockImplementation(async (args: any) => {
    const ordered = args.orderBy.createdAt === 'asc' ? transcript : [...transcript].reverse();
    return ordered.slice(0, args.take) as any;
  });
  const history = await getRecentHistory('synthetic-session');
  const result = { totalMessages: 25, returnedMessages: history.length,
    first: history[0].content, last: history.at(-1)?.content,
    containsLatest: history.some(m => m.content === 'turn-25'),
    query: vi.mocked(prisma.assistantMessage.findMany).mock.calls[0][0] };
  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, 'memory.json'), JSON.stringify(result, null, 2));
  // Characterisation assertion, NOT an acceptance criterion for correct memory.
  expect(result.containsLatest).toBe(false);
});
