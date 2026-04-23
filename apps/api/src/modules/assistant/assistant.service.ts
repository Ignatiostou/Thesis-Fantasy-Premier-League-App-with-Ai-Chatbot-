// apps/api/src/modules/ai/assistant.service.ts
// One change from your version: passes `intent` to buildSystemPrompt
// so intent-specific guidance blocks are injected correctly.

import { prisma } from '../../db/prisma.js';
import { buildUserContext } from './context.service.js';
import { buildSystemPrompt, formatConversationHistory } from './prompt.service.js';
import {
  getOrCreateSession,
  getUserSessions,
  getSessionMessages,
  archiveSession,
  saveUserMessage,
  saveAssistantMessage,
  getRecentHistory,
} from './assistant.memory.service.js';
import { generateReply, generateReplyStream } from './assistant.llm.service.js';
import { detectAssistantIntent } from './assistant.intent.service.js';
import { buildRecommendationContext } from './recommendation.service.js';

export {
  getOrCreateSession,
  getUserSessions,
  getSessionMessages,
  archiveSession,
};

export interface SendMessageInput {
  userId:    string;
  sessionId: string;
  message:   string;
}

export interface ChatResult {
  sessionId:  string;
  messageId:  string;
  reply:      string;
  role:       'assistant';
  createdAt:  string;
}

// ── Non-streaming ─────────────────────────────────────────────────────────────

export async function sendMessage(input: SendMessageInput): Promise<ChatResult> {
  const { userId, sessionId, message } = input;

  if (!message?.trim()) throw new Error('EMPTY_MESSAGE');
  if (message.length > 2000) throw new Error('MESSAGE_TOO_LONG');

  const session = await prisma.assistantSession.findFirst({
    where: { id: sessionId, userId },
  });
  if (!session) throw new Error('SESSION_NOT_FOUND');

  await saveUserMessage(sessionId, message.trim());

  const history        = await getRecentHistory(sessionId);
  const intent         = detectAssistantIntent(message);
  const userCtx        = await buildUserContext(userId);
  const recommendation = await buildRecommendationContext({ userId, intent, message });

  // Pass intent so the prompt gets intent-specific guidance blocks
  const systemPrompt = buildSystemPrompt(
    userCtx,
    recommendation?.summary ?? null,
    intent,
  );

  const formattedHistory = formatConversationHistory(
    history.map((m) => ({ role: m.role.toLowerCase(), content: m.content })),
  );

  const replyText = await generateReply({
    systemPrompt,
    messages: formattedHistory,
  });

  const saved = await saveAssistantMessage(sessionId, replyText);

  await prisma.recommendationLog.create({
    data: {
      userId,
      sessionId,
      intent,
      recommendationType: intent,
      payload: {
        userMessage:               message.trim(),
        reply:                     replyText,
        recommendationStructured:  recommendation?.structured ?? null,
      } as any,
    },
  });

  return {
    sessionId,
    messageId: saved.id,
    reply:     replyText,
    role:      'assistant',
    createdAt: saved.createdAt.toISOString(),
  };
}

// ── Streaming ─────────────────────────────────────────────────────────────────

export async function* sendMessageStream(
  input: SendMessageInput,
): AsyncGenerator<string> {
  const { userId, sessionId, message } = input;

  if (!message?.trim()) throw new Error('EMPTY_MESSAGE');
  if (message.length > 2000) throw new Error('MESSAGE_TOO_LONG');

  const session = await prisma.assistantSession.findFirst({
    where: { id: sessionId, userId },
  });
  if (!session) throw new Error('SESSION_NOT_FOUND');

  await saveUserMessage(sessionId, message.trim());

  const history        = await getRecentHistory(sessionId);
  const intent         = detectAssistantIntent(message);
  const userCtx        = await buildUserContext(userId);
  const recommendation = await buildRecommendationContext({ userId, intent, message });

  // Pass intent so the prompt gets intent-specific guidance blocks
  const systemPrompt = buildSystemPrompt(
    userCtx,
    recommendation?.summary ?? null,
    intent,
  );

  const formattedHistory = formatConversationHistory(
    history.map((m) => ({ role: m.role.toLowerCase(), content: m.content })),
  );

  let fullReply = '';

  const stream = generateReplyStream({
    systemPrompt,
    messages: formattedHistory,
  });

  for await (const delta of stream) {
    fullReply += delta;
    yield delta;
  }

  const saved = await saveAssistantMessage(sessionId, fullReply);

  await prisma.recommendationLog.create({
    data: {
      userId,
      sessionId,
      intent,
      recommendationType: `${intent}_STREAM`,
      payload: {
        userMessage:              message.trim(),
        reply:                    fullReply,
        recommendationStructured: recommendation?.structured ?? null,
      } as any,
    },
  });

  void saved;
}