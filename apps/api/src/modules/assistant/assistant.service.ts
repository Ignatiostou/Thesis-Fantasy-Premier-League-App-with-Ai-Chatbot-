import { prisma }                          from '../../db/prisma.js';
import { buildUserContext }                from './context.service.js';
import { buildSystemPrompt, formatConversationHistory } from './prompt.service.js';
import {
  getOrCreateSession,
  getUserSessions,
  getSessionMessages,
  archiveSession,
  saveUserMessage,
  saveAssistantMessage,
  getRecentHistory,
}                                          from './assistant.memory.service.js';
import { generateReply, generateReplyStream } from './assistant.llm.service.js';
import { detectAssistantIntent }           from './assistant.intent.service.js';
import { buildRecommendationContext }      from './recommendation.service.js';
// IMPROVEMENT #10: shared constant instead of a locally-duplicated `2000` literal.


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

const MAX_CHAT_MESSAGE_LENGTH = 2000;  



async function prepareChat(userId: string, input: SendMessageInput) {
  const { sessionId, message } = input;

  if (!message?.trim()) throw new Error('EMPTY_MESSAGE');
  if (message.length > MAX_CHAT_MESSAGE_LENGTH) throw new Error('MESSAGE_TOO_LONG');

  const session = await prisma.assistantSession.findFirst({
    where: { id: sessionId, userId },
  });
  if (!session) throw new Error('SESSION_NOT_FOUND');

  await saveUserMessage(sessionId, message.trim());

  const history  = await getRecentHistory(sessionId);
  const intent   = detectAssistantIntent(message);
  const userCtx  = await buildUserContext(userId);

  // Run heuristic + ML recommendation pipeline
  const recommendation = await buildRecommendationContext({ userId, intent, message });

  // recommendation.summary already contains both ML promptBlock and heuristic text
  // (joined by recommendation.service.ts). Pass it as the recommendationBlock param.
  // intent is passed separately so prompt.service adds intent-specific guidance.
  const systemPrompt = buildSystemPrompt(
    userCtx,
    recommendation?.summary ?? null,
    intent,
  );

  const formattedHistory = formatConversationHistory(
    history.map((m) => ({ role: m.role.toLowerCase(), content: m.content })),
  );

  return {
    sessionId,
    intent,
    userCtx,
    trimmedMessage: message.trim(),
    systemPrompt,
    formattedHistory,
    recommendation,  // includes mlBlock for RecommendationLog storage
  };
}

// ── Non-streaming chat ────────────────────────────────────────────────────────

export async function sendMessage(input: SendMessageInput): Promise<ChatResult> {
  const {
    sessionId, intent, trimmedMessage,
    systemPrompt, formattedHistory, recommendation,
  } = await prepareChat(input.userId, input);

  const replyText = await generateReply({
    systemPrompt,
    messages: formattedHistory,
    intent, // IMPROVEMENT #1: lets the LLM layer pick factual vs. conversational temperature
  });

  const saved = await saveAssistantMessage(sessionId, replyText);

  // Store both heuristic structured data AND ML structured data in the log
  await prisma.recommendationLog.create({
    data: {
      userId:             input.userId,
      sessionId,
      intent,
      recommendationType: intent,
      payload: {
        userMessage:        trimmedMessage,
        reply:              replyText,
        // Heuristic structured output (captaincy candidates, comparison, transfer)
        recommendationStructured: recommendation?.structured ?? null,
        // ML structured output (CaptaincyRecommendation, TransferRecommendationResult, etc.)
        mlStructured:       recommendation?.mlBlock?.structured ?? null,
        mlAvailable:        recommendation?.mlBlock?.available ?? false,
        // IMPROVEMENT #3: log which source (ML vs heuristic) was treated as
        // primary for this answer, and why, so disagreements are auditable.
        conflictResolution: recommendation?.conflictResolution ?? null,
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


export type ChatStreamEvent =
  | { kind: 'meta';  primarySource: 'ML' | 'HEURISTIC' | 'ML_ONLY' | 'HEURISTIC_ONLY'; reason: string }
  | { kind: 'delta'; text: string };

export async function* sendMessageStream(
  input: SendMessageInput,
): AsyncGenerator<ChatStreamEvent> {
  const {
    sessionId, intent, trimmedMessage,
    systemPrompt, formattedHistory, recommendation,
  } = await prepareChat(input.userId, input);

  if (recommendation?.conflictResolution) {
    yield {
      kind: 'meta',
      primarySource: recommendation.conflictResolution.primarySource,
      reason: recommendation.conflictResolution.reason,
    };
  }

  let fullReply = '';
  let wasInterrupted = false;

  const stream = generateReplyStream({
    systemPrompt,
    messages: formattedHistory,
    intent, // IMPROVEMENT #1
  });

  try {
    for await (const delta of stream) {
      fullReply += delta;
      yield { kind: 'delta', text: delta };
    }
  } catch (err) {
    // IMPROVEMENT #6: don't let a mid-stream error/disconnect (e.g. the
    // client closing the SSE connection) skip persistence below — we still
    // want to save whatever was generated so far and flag it as partial.
    wasInterrupted = true;
    console.error('[AI stream] interrupted before completion:', err);
  } finally {
    // IMPROVEMENT #6: this block now always runs, even on early return /
    // thrown error from the generator's consumer (e.g. client disconnect),
    // so a dropped connection no longer silently discards paid-for LLM output.
    if (fullReply.trim().length > 0) {
      const saved = await saveAssistantMessage(sessionId, fullReply);

      await prisma.recommendationLog.create({
        data: {
          userId:             input.userId,
          sessionId,
          intent,
          recommendationType: `${intent}_STREAM`,
          payload: {
            userMessage:        trimmedMessage,
            reply:              fullReply,
            wasInterrupted,
            recommendationStructured: recommendation?.structured ?? null,
            mlStructured:       recommendation?.mlBlock?.structured ?? null,
            mlAvailable:        recommendation?.mlBlock?.available ?? false,
            conflictResolution: recommendation?.conflictResolution ?? null,
          } as any,
        },
      });

      void saved;
    }
  }
}
