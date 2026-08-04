// apps/api/src/modules/ai/__tests__/assistant.service.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db/prisma.js', () => ({
  prisma: {
    assistantSession: {
      findFirst: vi.fn(),
    },
    recommendationLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock('../context.service.js', () => ({
  buildUserContext: vi.fn().mockResolvedValue({
    username: 'testmanager', gameweek: 34, hasTeam: true,
    profileSummary: 'balanced', squad: [], freeTransfers: 1,
  }),
}));

vi.mock('../prompt.service.js', () => ({
  buildSystemPrompt: vi.fn().mockReturnValue('You are CoachBot.'),
  formatConversationHistory: vi.fn().mockReturnValue([]),
}));

vi.mock('../assistant.memory.service.js', () => ({
  getOrCreateSession:  vi.fn(),
  getUserSessions:     vi.fn(),
  getSessionMessages:  vi.fn(),
  archiveSession:      vi.fn(),
  saveUserMessage:     vi.fn().mockResolvedValue({ id: 'msg_u1' }),
  saveAssistantMessage: vi.fn().mockResolvedValue({ id: 'msg_a1', createdAt: new Date('2024-01-01') }),
  getRecentHistory:    vi.fn().mockResolvedValue([]),
}));

vi.mock('../assistant.llm.service.js', () => ({
  generateReply:       vi.fn().mockResolvedValue('Great advice from CoachBot!'),
  generateReplyStream: vi.fn(),
}));

vi.mock('../assistant.intent.service.js', () => ({
  detectAssistantIntent: vi.fn().mockReturnValue('CAPTAINCY'),
}));

vi.mock('../recommendation.service.js', () => ({
  buildRecommendationContext: vi.fn().mockResolvedValue({
    intent:     'CAPTAINCY',
    summary:    'Salah is your best captain.',
    structured: { candidates: [] },
    mlBlock:    null,
  }),
}));

import { prisma } from '../../../db/prisma.js';
import { sendMessage, sendMessageStream } from '../assistant.service.js';
import { generateReply, generateReplyStream } from '../assistant.llm.service.js';
import { buildRecommendationContext } from '../recommendation.service.js';

const mock = prisma as any;

const ACTIVE_SESSION = { id: 'sess_1', userId: 'user_1', status: 'ACTIVE' };

// ── sendMessage ───────────────────────────────────────────────────────────────

describe('sendMessage', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    mock.assistantSession.findFirst.mockResolvedValue(ACTIVE_SESSION);
    mock.recommendationLog.create.mockResolvedValue({});
  });

  it('returns a ChatResult with reply and sessionId', async () => {
    const result = await sendMessage({
      userId:    'user_1',
      sessionId: 'sess_1',
      message:   'who should be my captain',
    });
    expect(result.reply).toBe('Great advice from CoachBot!');
    expect(result.sessionId).toBe('sess_1');
    expect(result.role).toBe('assistant');
    expect(result.messageId).toBe('msg_a1');
  });

  it('throws EMPTY_MESSAGE for blank message', async () => {
    await expect(sendMessage({ userId: 'user_1', sessionId: 'sess_1', message: '' }))
      .rejects.toThrow('EMPTY_MESSAGE');
    await expect(sendMessage({ userId: 'user_1', sessionId: 'sess_1', message: '   ' }))
      .rejects.toThrow('EMPTY_MESSAGE');
  });

  it('throws MESSAGE_TOO_LONG for message > 2000 chars', async () => {
    await expect(sendMessage({ userId: 'user_1', sessionId: 'sess_1', message: 'a'.repeat(2001) }))
      .rejects.toThrow('MESSAGE_TOO_LONG');
  });

  it('throws SESSION_NOT_FOUND when session does not belong to user', async () => {
    mock.assistantSession.findFirst.mockResolvedValue(null);
    await expect(sendMessage({ userId: 'user_1', sessionId: 'wrong', message: 'captain?' }))
      .rejects.toThrow('SESSION_NOT_FOUND');
  });

  it('calls buildRecommendationContext with correct intent and message', async () => {
    await sendMessage({ userId: 'user_1', sessionId: 'sess_1', message: 'who to captain' });
    expect(buildRecommendationContext).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user_1', intent: 'CAPTAINCY', message: 'who to captain' }),
    );
  });

  it('calls generateReply with the system prompt', async () => {
    await sendMessage({ userId: 'user_1', sessionId: 'sess_1', message: 'captain?' });
    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({ systemPrompt: 'You are CoachBot.' }),
    );
  });

  it('saves a RecommendationLog entry after successful reply', async () => {
    await sendMessage({ userId: 'user_1', sessionId: 'sess_1', message: 'captain?' });
    expect(mock.recommendationLog.create).toHaveBeenCalledOnce();
    const call = mock.recommendationLog.create.mock.calls[0][0];
    expect(call.data.userId).toBe('user_1');
    expect(call.data.sessionId).toBe('sess_1');
    expect(call.data.intent).toBe('CAPTAINCY');
  });

  it('stores the user message and the AI reply in the log', async () => {
    await sendMessage({ userId: 'user_1', sessionId: 'sess_1', message: 'captain pick?' });
    const call = mock.recommendationLog.create.mock.calls[0][0];
    expect(call.data.payload.userMessage).toBe('captain pick?');
    expect(call.data.payload.reply).toBe('Great advice from CoachBot!');
  });

  it('includes recommendation structured data in the log payload', async () => {
    await sendMessage({ userId: 'user_1', sessionId: 'sess_1', message: 'captain?' });
    const call = mock.recommendationLog.create.mock.calls[0][0];
    expect(call.data.payload.recommendationStructured).toBeDefined();
  });

  it('handles null recommendation gracefully', async () => {
    vi.mocked(buildRecommendationContext).mockResolvedValueOnce(null);
    await expect(
      sendMessage({ userId: 'user_1', sessionId: 'sess_1', message: 'captain?' }),
    ).resolves.not.toThrow();
  });

  it('trims whitespace from message before saving', async () => {
    const { saveUserMessage } = await import('../assistant.memory.service.js');
    await sendMessage({ userId: 'user_1', sessionId: 'sess_1', message: '  captain?  ' });
    expect(saveUserMessage).toHaveBeenCalledWith('sess_1', 'captain?');
  });

  it('returns createdAt as ISO string', async () => {
    const result = await sendMessage({ userId: 'user_1', sessionId: 'sess_1', message: 'hello' });
    expect(result.createdAt).toBe(new Date('2024-01-01').toISOString());
  });
});

// ── sendMessageStream ─────────────────────────────────────────────────────────

describe('sendMessageStream', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    mock.assistantSession.findFirst.mockResolvedValue(ACTIVE_SESSION);
    mock.recommendationLog.create.mockResolvedValue({});

    // Mock the stream to yield 3 delta chunks
    async function* mockStream() {
      yield 'Captain ';
      yield 'Salah ';
      yield 'this week.';
    }
    vi.mocked(generateReplyStream).mockReturnValue(mockStream() as any);

  });

  it('throws EMPTY_MESSAGE for blank message', async () => {
    const stream = sendMessageStream({ userId: 'user_1', sessionId: 'sess_1', message: '' });
    await expect(stream.next()).rejects.toThrow('EMPTY_MESSAGE');
  });

  it('throws MESSAGE_TOO_LONG for oversized message', async () => {
    const stream = sendMessageStream({ userId: 'user_1', sessionId: 'sess_1', message: 'x'.repeat(2001) });
    await expect(stream.next()).rejects.toThrow('MESSAGE_TOO_LONG');
  });

  it('throws SESSION_NOT_FOUND for invalid session', async () => {
    mock.assistantSession.findFirst.mockResolvedValue(null);
    const stream = sendMessageStream({ userId: 'user_1', sessionId: 'bad', message: 'hello' });
    await expect(stream.next()).rejects.toThrow('SESSION_NOT_FOUND');
  });

  it('yields all delta chunks from the LLM stream', async () => {
    const deltas: string[] = [];
    for await (const event of sendMessageStream({ userId: 'user_1', sessionId: 'sess_1', message: 'captain?' })) {
      if (event.kind === 'delta') deltas.push(event.text);
    }
    expect(deltas).toEqual(['Captain ', 'Salah ', 'this week.']);
  });

  it('assembles full reply and saves it after streaming completes', async () => {
    const { saveAssistantMessage } = await import('../assistant.memory.service.js');

    for await (const _ of sendMessageStream({ userId: 'user_1', sessionId: 'sess_1', message: 'captain?' })) {
      // consume stream
    }

    expect(saveAssistantMessage).toHaveBeenCalledWith('sess_1', 'Captain Salah this week.');
  });

  it('saves a RecommendationLog entry after stream completes', async () => {
    for await (const _ of sendMessageStream({ userId: 'user_1', sessionId: 'sess_1', message: 'captain?' })) {
      // consume
    }
    expect(mock.recommendationLog.create).toHaveBeenCalledOnce();
    const call = mock.recommendationLog.create.mock.calls[0][0];
    expect(call.data.recommendationType).toContain('_STREAM');
  });
});