import type { Request, Response } from 'express';
import { z } from 'zod';
import * as aiService from './assistant.service.js';
import * as onboardingService from './onboarding.service.js';
import { buildUserContext } from './context.service.js';

type AuthRequest = Request & { userId?: string };


const MAX_CHAT_MESSAGE_LENGTH = 2000; 

function ok<T>(res: Response, data: T) {
  return res.json({ success: true, data });
}

function fail(res: Response, status: number, error: string) {
  return res.status(status).json({ success: false, error });
}

const sendMessageSchema = z.object({
  message: z.string().min(1).max(MAX_CHAT_MESSAGE_LENGTH),
  sessionId: z.string().optional(),
});

const onboardingAnswersSchema = z.object({
  riskTolerance: z.number().int().min(1).max(3),
  budgetStyle: z.number().int().min(1).max(3),
  preferredFocus: z.number().int().min(1).max(3),
  differentialPreference: z.number().int().min(1).max(3),
  planningHorizon: z.number().int().min(1).max(3),
  explanationDepth: z.number().int().min(1).max(3),
  topSixAffinity: z.number().int().min(1).max(3),
  captaincyStyle: z.number().int().min(1).max(3),
  transferFrequency: z.number().int().min(1).max(3),
  fixtureAwareness: z.number().int().min(1).max(3),
});

const onboardingStepSchema = z.object({
  step: z.number().int().min(1).max(10),
  questionId: z.string(),
  value: z.number().int().min(1).max(3),
});

export async function getOnboardingQuestions(_req: Request, res: Response) {
  try {
    const questions = onboardingService.getOnboardingQuestions();
    return ok(res, { questions });
  } catch (e: any) {
    return fail(res, 500, e.message ?? 'Failed to load questions');
  }
}

export async function getOnboardingStatus(req: AuthRequest, res: Response) {
  try {
    if (!req.userId) return fail(res, 401, 'Unauthorized');

    const profile = await onboardingService.getAssistantProfile(req.userId);
    return ok(res, {
      completed: profile?.onboardingCompleted ?? false,
      step: profile?.onboardingStep ?? 0,
      hasProfile: !!profile,
    });
  } catch (e: any) {
    return fail(res, 500, e.message ?? 'Failed to load onboarding status');
  }
}

export async function saveOnboardingStep(req: AuthRequest, res: Response) {
  if (!req.userId) return fail(res, 401, 'Unauthorized');

  const parsed = onboardingStepSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: parsed.error.flatten() });
  }

  try {
    const result = await onboardingService.saveOnboardingStep(
      req.userId,
      parsed.data.step,
      parsed.data.questionId,
      parsed.data.value,
    );
    return ok(res, result);
  } catch (e: any) {
    return fail(res, 400, e.message ?? 'Failed to save step');
  }
}

export async function completeOnboarding(req: AuthRequest, res: Response) {
  if (!req.userId) return fail(res, 401, 'Unauthorized');

  const parsed = onboardingAnswersSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: parsed.error.flatten() });
  }

  try {
    const profile = await onboardingService.saveOnboardingAnswers(
      req.userId,
      parsed.data as any // Zod validates the values are 1-3, safe to cast
    );
    return ok(res, { completed: true, profileId: profile.id });
  } catch (e: any) {
    return fail(res, 400, e.message ?? 'Failed to complete onboarding');
  }
}

export async function getSessions(req: AuthRequest, res: Response) {
  try {
    if (!req.userId) return fail(res, 401, 'Unauthorized');

    const sessions = await aiService.getUserSessions(req.userId);
    return ok(res, {
      sessions: sessions.map((s) => ({
        id: s.id,
        title: s.title,
        status: s.status,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
        lastMessage: s.messages[0]
          ? {
              content: s.messages[0].content,
              createdAt: s.messages[0].createdAt.toISOString(),
            }
          : null,
      })),
    });
  } catch (e: any) {
    return fail(res, 500, e.message ?? 'Failed to load sessions');
  }
}

export async function getSessionMessages(req: AuthRequest, res: Response) {
  try {
    if (!req.userId) return fail(res, 401, 'Unauthorized');

    const sessionId = typeof req.params.sessionId === 'string'
      ? req.params.sessionId
      : req.params.sessionId?.[0] ?? '';
    const messages = await aiService.getSessionMessages(req.userId, sessionId);
    return ok(res, {
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  } catch (e: any) {
    if (e.message === 'SESSION_NOT_FOUND') return fail(res, 404, 'Session not found');
    return fail(res, 500, e.message ?? 'Failed to load messages');
  }
}

export async function archiveSession(req: AuthRequest, res: Response) {
  try {
    if (!req.userId) return fail(res, 401, 'Unauthorized');

    const sessionId = typeof req.params.sessionId === 'string'
      ? req.params.sessionId
      : req.params.sessionId?.[0] ?? '';
    await aiService.archiveSession(req.userId, sessionId);
    return ok(res, { archived: true });
  } catch (e: any) {
    if (e.message === 'SESSION_NOT_FOUND') return fail(res, 404, 'Session not found');
    return fail(res, 500, e.message ?? 'Failed to archive session');
  }
}

export async function chat(req: AuthRequest, res: Response) {
  if (!req.userId) return fail(res, 401, 'Unauthorized');

  const parsed = sendMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: parsed.error.flatten() });
  }

  try {
    const session = await aiService.getOrCreateSession(
      req.userId,
      parsed.data.sessionId,
    );

    const result = await aiService.sendMessage({
      userId: req.userId,
      sessionId: session.id,
      message: parsed.data.message,
    });

    return ok(res, result);
  } catch (e: any) {
    if (e.message === 'SESSION_NOT_FOUND') return fail(res, 404, 'Session not found');
    if (e.message === 'EMPTY_MESSAGE') return fail(res, 400, 'Message cannot be empty');
    if (e.message === 'MESSAGE_TOO_LONG') return fail(res, 400, `Message too long (max ${MAX_CHAT_MESSAGE_LENGTH} chars)`);
    console.error('[AI chat]', e);
    return fail(res, 500, e.message ?? 'Failed to get AI response');
  }
}

export async function chatStream(req: AuthRequest, res: Response) {
  if (!req.userId) return fail(res, 401, 'Unauthorized');

  const parsed = sendMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: parsed.error.flatten() });
  }

  try {
    const session = await aiService.getOrCreateSession(
      req.userId,
      parsed.data.sessionId,
    );

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Session-Id', session.id);
    res.flushHeaders();

    res.write(`data: ${JSON.stringify({ type: 'session', sessionId: session.id })}\n\n`);

    const stream = aiService.sendMessageStream({
      userId: req.userId,
      sessionId: session.id,
      message: parsed.data.message,
    });

    
    for await (const event of stream) {
      if (event.kind === 'meta') {
        res.write(`data: ${JSON.stringify({
          type: 'meta',
          primarySource: event.primarySource,
          reason: event.reason,
        })}\n\n`);
      } else if (event.kind === 'status') {
        res.write(`data: ${JSON.stringify({ type: 'status', message: event.message })}\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({ type: 'delta', content: event.text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (e: any) {
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`);
      res.end();
    } else {
      console.error('[AI stream]', e);
      return fail(res, 500, e.message ?? 'Stream failed');
    }
  }
}

export async function getContext(req: AuthRequest, res: Response) {
  try {
    if (!req.userId) return fail(res, 401, 'Unauthorized');

    const ctx = await buildUserContext(req.userId);
    return ok(res, ctx);
  } catch (e: any) {
    return fail(res, 500, e.message ?? 'Failed to build context');
  }
}
