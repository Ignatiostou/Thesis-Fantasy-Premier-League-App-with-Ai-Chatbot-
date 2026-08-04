// apps/api/src/modules/ai/__tests__/assistant.memory.service.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db/prisma.js', () => ({
  prisma: {
    assistantSession: {
      findFirst:  vi.fn(),
      findMany:   vi.fn(),
      create:     vi.fn(),
      update:     vi.fn(),
    },
    assistantMessage: {
      findMany: vi.fn(),
      create:   vi.fn(),
    },
  },
}));

import { prisma } from '../../../db/prisma.js';
import {
  getOrCreateSession,
  getUserSessions,
  getSessionMessages,
  archiveSession,
  saveUserMessage,
  saveAssistantMessage,
  getRecentHistory,
} from '../assistant.memory.service.js';

const mock = prisma as any;

const SESSION = { id: 'sess_1', userId: 'user_1', title: 'FPL Coaching Session', status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date() };
const MESSAGE = { id: 'msg_1', sessionId: 'sess_1', role: 'USER', content: 'hello', createdAt: new Date() };

// ── getOrCreateSession ────────────────────────────────────────────────────────

describe('getOrCreateSession', () => {

  beforeEach(() => vi.clearAllMocks());

  it('returns existing session when sessionId matches', async () => {
    mock.assistantSession.findFirst.mockResolvedValue(SESSION);
    const result = await getOrCreateSession('user_1', 'sess_1');
    expect(result.id).toBe('sess_1');
    expect(mock.assistantSession.create).not.toHaveBeenCalled();
  });

  it('creates new session when sessionId not found', async () => {
    mock.assistantSession.findFirst.mockResolvedValue(null);
    mock.assistantSession.create.mockResolvedValue(SESSION);
    const result = await getOrCreateSession('user_1', 'nonexistent');
    expect(mock.assistantSession.create).toHaveBeenCalledOnce();
    expect(result).toEqual(SESSION);
  });

  it('creates new session when no sessionId provided', async () => {
    mock.assistantSession.create.mockResolvedValue(SESSION);
    await getOrCreateSession('user_1');
    expect(mock.assistantSession.create).toHaveBeenCalledOnce();
    expect(mock.assistantSession.findFirst).not.toHaveBeenCalled();
  });

  it('creates session with ACTIVE status and correct userId', async () => {
    mock.assistantSession.create.mockResolvedValue(SESSION);
    await getOrCreateSession('user_abc');
    const call = mock.assistantSession.create.mock.calls[0][0];
    expect(call.data.userId).toBe('user_abc');
    expect(call.data.status).toBe('ACTIVE');
  });
});

// ── getUserSessions ───────────────────────────────────────────────────────────

describe('getUserSessions', () => {

  beforeEach(() => vi.clearAllMocks());

  it('returns list of active sessions', async () => {
    mock.assistantSession.findMany.mockResolvedValue([SESSION]);
    const result = await getUserSessions('user_1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('sess_1');
  });

  it('queries only ACTIVE sessions for the user', async () => {
    mock.assistantSession.findMany.mockResolvedValue([]);
    await getUserSessions('user_1');
    const call = mock.assistantSession.findMany.mock.calls[0][0];
    expect(call.where.userId).toBe('user_1');
    expect(call.where.status).toBe('ACTIVE');
  });

  it('limits to 10 sessions', async () => {
    mock.assistantSession.findMany.mockResolvedValue([]);
    await getUserSessions('user_1');
    const call = mock.assistantSession.findMany.mock.calls[0][0];
    expect(call.take).toBe(10);
  });

  it('returns empty array when user has no sessions', async () => {
    mock.assistantSession.findMany.mockResolvedValue([]);
    const result = await getUserSessions('user_1');
    expect(result).toEqual([]);
  });
});

// ── getSessionMessages ────────────────────────────────────────────────────────

describe('getSessionMessages', () => {

  beforeEach(() => vi.clearAllMocks());

  it('returns messages for a valid session', async () => {
    mock.assistantSession.findFirst.mockResolvedValue(SESSION);
    mock.assistantMessage.findMany.mockResolvedValue([MESSAGE]);
    const result = await getSessionMessages('user_1', 'sess_1');
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('hello');
  });

  it('throws SESSION_NOT_FOUND for wrong userId/sessionId', async () => {
    mock.assistantSession.findFirst.mockResolvedValue(null);
    await expect(getSessionMessages('user_1', 'wrong_session'))
      .rejects.toThrow('SESSION_NOT_FOUND');
  });

  it('queries messages ordered by createdAt ascending', async () => {
    mock.assistantSession.findFirst.mockResolvedValue(SESSION);
    mock.assistantMessage.findMany.mockResolvedValue([]);
    await getSessionMessages('user_1', 'sess_1');
    const call = mock.assistantMessage.findMany.mock.calls[0][0];
    expect(call.orderBy.createdAt).toBe('asc');
  });
});

// ── archiveSession ────────────────────────────────────────────────────────────

describe('archiveSession', () => {

  beforeEach(() => vi.clearAllMocks());

  it('archives an existing session', async () => {
    mock.assistantSession.findFirst.mockResolvedValue(SESSION);
    mock.assistantSession.update.mockResolvedValue({ ...SESSION, status: 'ARCHIVED' });
    await archiveSession('user_1', 'sess_1');
    expect(mock.assistantSession.update).toHaveBeenCalledWith({
      where: { id: 'sess_1' },
      data:  { status: 'ARCHIVED' },
    });
  });

  it('throws SESSION_NOT_FOUND when session does not belong to user', async () => {
    mock.assistantSession.findFirst.mockResolvedValue(null);
    await expect(archiveSession('user_1', 'other_session'))
      .rejects.toThrow('SESSION_NOT_FOUND');
    expect(mock.assistantSession.update).not.toHaveBeenCalled();
  });
});

// ── saveUserMessage ───────────────────────────────────────────────────────────

describe('saveUserMessage', () => {

  beforeEach(() => vi.clearAllMocks());

  it('creates a message with role USER', async () => {
    mock.assistantMessage.create.mockResolvedValue(MESSAGE);
    await saveUserMessage('sess_1', 'hello');
    expect(mock.assistantMessage.create).toHaveBeenCalledWith({
      data: { sessionId: 'sess_1', role: 'USER', content: 'hello' },
    });
  });

  it('returns the created message', async () => {
    mock.assistantMessage.create.mockResolvedValue(MESSAGE);
    const result = await saveUserMessage('sess_1', 'hello');
    expect(result).toEqual(MESSAGE);
  });
});

// ── saveAssistantMessage ──────────────────────────────────────────────────────

describe('saveAssistantMessage', () => {

  beforeEach(() => vi.clearAllMocks());

  it('creates a message with role ASSISTANT', async () => {
    mock.assistantMessage.create.mockResolvedValue({ ...MESSAGE, role: 'ASSISTANT' });
    mock.assistantSession.update.mockResolvedValue(SESSION);
    await saveAssistantMessage('sess_1', 'Here is my advice');
    const call = mock.assistantMessage.create.mock.calls[0][0];
    expect(call.data.role).toBe('ASSISTANT');
    expect(call.data.content).toBe('Here is my advice');
  });

  it('updates session updatedAt after saving', async () => {
    mock.assistantMessage.create.mockResolvedValue(MESSAGE);
    mock.assistantSession.update.mockResolvedValue(SESSION);
    await saveAssistantMessage('sess_1', 'reply');
    expect(mock.assistantSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sess_1' } }),
    );
  });

  it('returns the saved message', async () => {
    const saved = { ...MESSAGE, role: 'ASSISTANT', content: 'reply' };
    mock.assistantMessage.create.mockResolvedValue(saved);
    mock.assistantSession.update.mockResolvedValue(SESSION);
    const result = await saveAssistantMessage('sess_1', 'reply');
    expect(result).toEqual(saved);
  });
});

// ── getRecentHistory ──────────────────────────────────────────────────────────

describe('getRecentHistory', () => {

  beforeEach(() => vi.clearAllMocks());

  it('returns conversation history for a session', async () => {
    const history = [
      { role: 'USER',      content: 'hello' },
      { role: 'ASSISTANT', content: 'hi there' },
    ];
    mock.assistantMessage.findMany.mockResolvedValue(history);
    const result = await getRecentHistory('sess_1');
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('USER');
    expect(result[1].role).toBe('ASSISTANT');
  });

  it('limits to MAX_HISTORY (20) messages', async () => {
    mock.assistantMessage.findMany.mockResolvedValue([]);
    await getRecentHistory('sess_1');
    const call = mock.assistantMessage.findMany.mock.calls[0][0];
    expect(call.take).toBe(20);
  });

  it('returns messages ordered ascending by createdAt', async () => {
    mock.assistantMessage.findMany.mockResolvedValue([]);
    await getRecentHistory('sess_1');
    const call = mock.assistantMessage.findMany.mock.calls[0][0];
    expect(call.orderBy.createdAt).toBe('asc');
  });

  it('returns empty array for session with no messages', async () => {
    mock.assistantMessage.findMany.mockResolvedValue([]);
    const result = await getRecentHistory('sess_1');
    expect(result).toEqual([]);
  });
});