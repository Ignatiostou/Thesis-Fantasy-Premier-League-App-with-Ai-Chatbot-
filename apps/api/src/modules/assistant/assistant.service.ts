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
import {
  detectAssistantIntent,
  isFplRelated,
  OUT_OF_SCOPE_REPLY,
} from './assistant.intent.service.js';
import { buildRecommendationContext }      from './recommendation.service.js';
import { findMentionedPlayers }            from './player-search.service.js';
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

  // Deterministic scope gate — see isFplRelated(). Refusing here, before the
  // recommendation pipeline and the LLM call, means an off-topic message costs
  // nothing and the refusal is identical every time.
  //
  // isFplRelated() is pure keyword matching, so a message that's ONLY player
  // names ("Saka? Gabriel? Havertz?") — no captain/transfer/squad vocabulary
  // at all — scores zero and looks off-topic even though naming real
  // footballers is exactly what an FPL coach should field. Only run this
  // (DB-backed) fallback when the cheap keyword check already failed.
  if (!isFplRelated(message)) {
    const mentioned = await findMentionedPlayers(message, 1);
    if (mentioned.length === 0) {
      return { sessionId, outOfScope: true as const, trimmedMessage: message.trim() };
    }
  }

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
    outOfScope: false as const,
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
  const prepared = await prepareChat(input.userId, input);

  if (prepared.outOfScope) {
    const refused = await saveAssistantMessage(prepared.sessionId, OUT_OF_SCOPE_REPLY);
    return {
      sessionId: prepared.sessionId,
      messageId: refused.id,
      reply:     OUT_OF_SCOPE_REPLY,
      role:      'assistant',
      createdAt: refused.createdAt.toISOString(),
    };
  }

  const {
    sessionId, intent, trimmedMessage,
    systemPrompt, formattedHistory, recommendation,
  } = prepared;

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
  | { kind: 'meta';   primarySource: 'ML' | 'HEURISTIC' | 'ML_ONLY' | 'HEURISTIC_ONLY'; reason: string }
  | { kind: 'status'; message: string }
  | { kind: 'delta';  text: string };

export async function* sendMessageStream(
  input: SendMessageInput,
): AsyncGenerator<ChatStreamEvent> {
  // Cheap pre-check, before the (possibly slow) prepareChat/buildRecommendationContext
  // call below: INITIAL_SQUAD for a user with no team yet routes to the ILP squad
  // optimizer (spawns Python, can take up to ~60s). Warn the frontend so it can
  // show something more informative than a plain "thinking" spinner for a minute.
  if (detectAssistantIntent(input.message) === 'INITIAL_SQUAD') {
    const team = await prisma.userTeam.findUnique({
      where:  { userId: input.userId },
      select: { id: true },
    });
    if (!team) {
      yield {
        kind: 'status',
        message: 'Building your initial squad with the ML optimizer — this can take up to a minute…',
      };
    }
  }

  const prepared = await prepareChat(input.userId, input);

  if (prepared.outOfScope) {
    yield { kind: 'delta', text: OUT_OF_SCOPE_REPLY };
    await saveAssistantMessage(prepared.sessionId, OUT_OF_SCOPE_REPLY);
    return;
  }

  const {
    sessionId, intent, trimmedMessage,
    systemPrompt, formattedHistory, recommendation,
  } = prepared;

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
