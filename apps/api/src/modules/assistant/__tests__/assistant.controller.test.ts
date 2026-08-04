// apps/api/src/modules/ai/__tests__/assistant.controller.test.ts
//
// Tests the HTTP layer — request validation, auth guards, error mapping.
// Uses mock req/res objects instead of supertest to avoid needing a running server.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../assistant.service.js', () => ({
  getOrCreateSession:  vi.fn(),
  getUserSessions:     vi.fn(),
  getSessionMessages:  vi.fn(),
  archiveSession:      vi.fn(),
  sendMessage:         vi.fn(),
  sendMessageStream:   vi.fn(),
}));

vi.mock('../onboarding.service.js', () => ({
  getOnboardingQuestions: vi.fn(),
  getAssistantProfile:    vi.fn(),
  saveOnboardingStep:     vi.fn(),
  saveOnboardingAnswers:  vi.fn(),
}));

vi.mock('../context.service.js', () => ({
  buildUserContext: vi.fn(),
}));

import * as controller from '../assistant.controller.js';
import * as aiService from '../assistant.service.js';
import * as onboardingService from '../onboarding.service.js';
import { buildUserContext } from '../context.service.js';

// ── Mock helpers ──────────────────────────────────────────────────────────────

function mockReq(overrides: Record<string, any> = {}) {
  return {
    userId: 'user_1',
    body:   {},
    params: {},
    ...overrides,
  } as any;
}

function mockRes() {
  const res: any = {};
  res.status   = vi.fn().mockReturnValue(res);
  res.json     = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  res.flushHeaders = vi.fn();
  res.write    = vi.fn();
  res.end      = vi.fn();
  res.headersSent = false;
  return res;
}

// ── getOnboardingQuestions ────────────────────────────────────────────────────

describe('getOnboardingQuestions', () => {

  beforeEach(() => vi.clearAllMocks());

  it('returns questions with success: true', async () => {
    vi.mocked(onboardingService.getOnboardingQuestions).mockReturnValue([{ id: 'q1', text: 'Q?', options: [] }] as any);
    const res = mockRes();
    await controller.getOnboardingQuestions(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('returns 500 when service throws', async () => {
    vi.mocked(onboardingService.getOnboardingQuestions).mockImplementation(() => { throw new Error('DB error'); });
    const res = mockRes();
    await controller.getOnboardingQuestions(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ── getOnboardingStatus ───────────────────────────────────────────────────────

describe('getOnboardingStatus', () => {

  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when userId is missing', async () => {
    const res = mockRes();
    await controller.getOnboardingStatus(mockReq({ userId: undefined }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns completed:false when no profile exists', async () => {
    vi.mocked(onboardingService.getAssistantProfile).mockResolvedValue(null);
    const res = mockRes();
    await controller.getOnboardingStatus(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ completed: false, hasProfile: false }),
    }));
  });

  it('returns completed:true when profile is complete', async () => {
    vi.mocked(onboardingService.getAssistantProfile).mockResolvedValue({
      onboardingCompleted: true,
      onboardingStep: 10,
    } as any);
    const res = mockRes();
    await controller.getOnboardingStatus(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ completed: true, step: 10 }),
    }));
  });
});

// ── saveOnboardingStep ────────────────────────────────────────────────────────

describe('saveOnboardingStep', () => {

  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when userId is missing', async () => {
    const res = mockRes();
    await controller.saveOnboardingStep(mockReq({ userId: undefined }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 400 for invalid body (missing fields)', async () => {
    const res = mockRes();
    await controller.saveOnboardingStep(mockReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 for step out of range', async () => {
    const res = mockRes();
    await controller.saveOnboardingStep(mockReq({ body: { step: 11, questionId: 'riskTolerance', value: 2 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 for value out of range (0)', async () => {
    const res = mockRes();
    await controller.saveOnboardingStep(mockReq({ body: { step: 1, questionId: 'riskTolerance', value: 0 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 for value out of range (4)', async () => {
    const res = mockRes();
    await controller.saveOnboardingStep(mockReq({ body: { step: 1, questionId: 'riskTolerance', value: 4 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns success for valid body', async () => {
    vi.mocked(onboardingService.saveOnboardingStep).mockResolvedValue({ id: 'p1' } as any);
    const res = mockRes();
    await controller.saveOnboardingStep(mockReq({ body: { step: 1, questionId: 'riskTolerance', value: 2 } }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('returns 400 when service throws INVALID_ANSWER_VALUE', async () => {
    vi.mocked(onboardingService.saveOnboardingStep).mockRejectedValue(new Error('INVALID_ANSWER_VALUE'));
    const res = mockRes();
    await controller.saveOnboardingStep(mockReq({ body: { step: 1, questionId: 'riskTolerance', value: 2 } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ── getSessions ───────────────────────────────────────────────────────────────

describe('getSessions', () => {

  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when userId is missing', async () => {
    const res = mockRes();
    await controller.getSessions(mockReq({ userId: undefined }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns formatted sessions list', async () => {
    vi.mocked(aiService.getUserSessions).mockResolvedValue([{
      id: 'sess_1', title: 'Session', status: 'ACTIVE',
      createdAt: new Date('2024-01-01'), updatedAt: new Date('2024-01-02'),
      messages: [{ content: 'last msg', createdAt: new Date('2024-01-02') }],
    }] as any);
    const res = mockRes();
    await controller.getSessions(mockReq(), res);
    const call = res.json.mock.calls[0][0];
    expect(call.success).toBe(true);
    expect(call.data.sessions[0].id).toBe('sess_1');
    expect(call.data.sessions[0].lastMessage?.content).toBe('last msg');
  });

  it('sets lastMessage to null when session has no messages', async () => {
    vi.mocked(aiService.getUserSessions).mockResolvedValue([{
      id: 'sess_1', title: 'Session', status: 'ACTIVE',
      createdAt: new Date(), updatedAt: new Date(), messages: [],
    }] as any);
    const res = mockRes();
    await controller.getSessions(mockReq(), res);
    const call = res.json.mock.calls[0][0];
    expect(call.data.sessions[0].lastMessage).toBeNull();
  });
});

// ── archiveSession ────────────────────────────────────────────────────────────

describe('archiveSession', () => {

  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when userId is missing', async () => {
    const res = mockRes();
    await controller.archiveSession(mockReq({ userId: undefined, params: { sessionId: 'sess_1' } }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 404 when session not found', async () => {
    vi.mocked(aiService.archiveSession).mockRejectedValue(new Error('SESSION_NOT_FOUND'));
    const res = mockRes();
    await controller.archiveSession(mockReq({ params: { sessionId: 'sess_1' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns archived: true on success', async () => {
    vi.mocked(aiService.archiveSession).mockResolvedValue({} as any);
    const res = mockRes();
    await controller.archiveSession(mockReq({ params: { sessionId: 'sess_1' } }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: { archived: true } }));
  });
});

// ── chat ──────────────────────────────────────────────────────────────────────

describe('chat', () => {

  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when userId is missing', async () => {
    const res = mockRes();
    await controller.chat(mockReq({ userId: undefined }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 400 for empty message', async () => {
    const res = mockRes();
    await controller.chat(mockReq({ body: { message: '' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 for message over 2000 chars', async () => {
    const res = mockRes();
    await controller.chat(mockReq({ body: { message: 'a'.repeat(2001) } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 for missing message field', async () => {
    const res = mockRes();
    await controller.chat(mockReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns AI reply on success', async () => {
    vi.mocked(aiService.getOrCreateSession).mockResolvedValue({ id: 'sess_1' } as any);
    vi.mocked(aiService.sendMessage).mockResolvedValue({
      sessionId: 'sess_1', messageId: 'msg_1',
      reply: 'Captain Salah.', role: 'assistant', createdAt: new Date().toISOString(),
    });
    const res = mockRes();
    await controller.chat(mockReq({ body: { message: 'who to captain?' } }), res);
    const call = res.json.mock.calls[0][0];
    expect(call.success).toBe(true);
    expect(call.data.reply).toBe('Captain Salah.');
  });

  it('returns 400 for EMPTY_MESSAGE from service', async () => {
    vi.mocked(aiService.getOrCreateSession).mockResolvedValue({ id: 'sess_1' } as any);
    vi.mocked(aiService.sendMessage).mockRejectedValue(new Error('EMPTY_MESSAGE'));
    const res = mockRes();
    await controller.chat(mockReq({ body: { message: 'hi' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 404 for SESSION_NOT_FOUND from service', async () => {
    vi.mocked(aiService.getOrCreateSession).mockResolvedValue({ id: 'sess_1' } as any);
    vi.mocked(aiService.sendMessage).mockRejectedValue(new Error('SESSION_NOT_FOUND'));
    const res = mockRes();
    await controller.chat(mockReq({ body: { message: 'hi' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 500 for unexpected errors', async () => {
    vi.mocked(aiService.getOrCreateSession).mockResolvedValue({ id: 'sess_1' } as any);
    vi.mocked(aiService.sendMessage).mockRejectedValue(new Error('DB crashed'));
    const res = mockRes();
    await controller.chat(mockReq({ body: { message: 'hi' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ── getContext ────────────────────────────────────────────────────────────────

describe('getContext', () => {

  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when userId is missing', async () => {
    const res = mockRes();
    await controller.getContext(mockReq({ userId: undefined }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns user context on success', async () => {
    vi.mocked(buildUserContext).mockResolvedValue({ username: 'testmanager', gameweek: 34 } as any);
    const res = mockRes();
    await controller.getContext(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    const call = res.json.mock.calls[0][0];
    expect(call.data.username).toBe('testmanager');
  });

  it('returns 500 when buildUserContext throws', async () => {
    vi.mocked(buildUserContext).mockRejectedValue(new Error('context failed'));
    const res = mockRes();
    await controller.getContext(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});