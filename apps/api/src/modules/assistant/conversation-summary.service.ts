import { prisma } from '../../db/prisma.js';
import { generateReply } from './assistant.llm.service.js';
import type { AssistantMessageRole } from '@prisma/client';

// ── Tunable thresholds ────────────────────────────────────────────────────────

/**
 * Total messages above which we maintain a rolling summary.
 * Below this we just use raw history, no summarisation needed.
 */
export const SUMMARISATION_TRIGGER_MESSAGES = 14;

/**
 * Only summarise messages that are this old (in #messages-since) so that the
 * model always sees the most recent context fully verbatim.
 */
export const KEEP_RECENT_MESSAGES = 10;

/**
 * Regenerate the summary every N new messages (so we don't call the LLM on
 * every turn).
 */
export const RESUMMARISATION_INTERVAL = 6;

/**
 * Max characters of the generated summary. Hard-truncated to protect the
 * prompt budget. Typical summaries should fit in 600-900 chars.
 */
export const MAX_SUMMARY_CHARS = 1200;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ConversationSummarySnapshot {
  summary:                string;        // empty string if none yet
  summarisedMessageCount: number;        // how many old messages it covers
  shouldRefresh:          boolean;       // does the caller need to regenerate?
}

interface SessionMessageRow {
  id:         string;
  role:       AssistantMessageRole;
  content:    string;
  createdAt:  Date;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Load the current summary for a session. Cheap — single row lookup.
 * Caller uses `shouldRefresh` to decide whether to call `refreshSummary` next.
 */
export async function loadSummary(sessionId: string): Promise<ConversationSummarySnapshot> {
  const session = await prisma.assistantSession.findUnique({
    where: { id: sessionId },
    select: {
      conversationSummary:    true,
      summarisedMessageCount: true,
      _count: { select: { messages: true } },
    },
  });

  if (!session) {
    return { summary: '', summarisedMessageCount: 0, shouldRefresh: false };
  }

  const totalMessages = session._count.messages;
  const summarised    = session.summarisedMessageCount ?? 0;
  const messagesSinceLastSummary = totalMessages - summarised;

  // shouldRefresh: total exceeds trigger AND enough new messages have accumulated
  const shouldRefresh =
    totalMessages > SUMMARISATION_TRIGGER_MESSAGES &&
    messagesSinceLastSummary > RESUMMARISATION_INTERVAL;

  return {
    summary:                session.conversationSummary ?? '',
    summarisedMessageCount: summarised,
    shouldRefresh,
  };
}

/**
 * Regenerate the summary for a session. Pulls the old messages, calls the
 * LLM to produce a structured summary, persists it. Use FIRE-AND-FORGET in
 * the background — don't block the user's reply on this.
 */
export async function refreshSummary(
  sessionId: string,
  userId:    string,
): Promise<ConversationSummarySnapshot> {
  // 1. Fetch the count of total messages
  const totalCount = await prisma.assistantMessage.count({
    where: { sessionId, session: { userId } },
  });

  if (totalCount <= SUMMARISATION_TRIGGER_MESSAGES) {
    // Not enough to summarise yet. Clear any stale summary.
    await prisma.assistantSession.update({
      where: { id: sessionId },
      data: {
        conversationSummary:    null,
        summarisedMessageCount: 0,
        summaryLastUpdatedAt:   new Date(),
      },
    });
    return { summary: '', summarisedMessageCount: 0, shouldRefresh: false };
  }

  // 2. Fetch the OLDER messages (everything before the last KEEP_RECENT_MESSAGES)
  const oldMessagesCount = totalCount - KEEP_RECENT_MESSAGES;
  if (oldMessagesCount < 4) {
    return { summary: '', summarisedMessageCount: 0, shouldRefresh: false };
  }

  const oldMessages: SessionMessageRow[] = await prisma.assistantMessage.findMany({
    where:    { sessionId, session: { userId } },
    orderBy:  { createdAt: 'asc' },
    take:     oldMessagesCount,
    select:   { id: true, role: true, content: true, createdAt: true },
  });

  if (oldMessages.length === 0) {
    return { summary: '', summarisedMessageCount: 0, shouldRefresh: false };
  }

  // 3. Build a tight prompt for the summarisation LLM call
  const transcript = oldMessages
    .map((m) => `${m.role === 'USER' ? 'USER' : 'ASSISTANT'}: ${m.content}`)
    .join('\n---\n');

  const systemPrompt =
    `You are a context-compression assistant. The user is having a long ` +
    `coaching session about Fantasy Premier League. Compress the OLDER ` +
    `portion of their conversation into a structured summary that ` +
    `preserves what would help a future assistant turn understand:\n` +
    `  - Stated preferences (e.g. "never captain X away", "avoids team Y")\n` +
    `  - Ongoing plans (Wildcard timing, target players, fixture targeting)\n` +
    `  - Constraints they mentioned (budget left, free transfers, hits taken)\n` +
    `  - Decisions already made (captain selected, transfers done)\n` +
    `\n` +
    `OUTPUT FORMAT (use exact headers, omit a section if no info for it):\n` +
    `\n` +
    `## STATED PREFERENCES\n` +
    `- bullet points, one preference each\n` +
    `\n` +
    `## ONGOING PLANS\n` +
    `- ...\n` +
    `\n` +
    `## CONSTRAINTS\n` +
    `- ...\n` +
    `\n` +
    `## DECISIONS ALREADY MADE\n` +
    `- ...\n` +
    `\n` +
    `Be concise. Skip pleasantries, generic FPL trivia, and anything that ` +
    `would not affect a future recommendation. Target 100-250 words total.`;

  const userPrompt = `Older conversation transcript:\n\n${transcript}\n\n` +
    `Produce the structured summary now.`;

  // 4. Call the LLM
  let summary = '';
  try {
    summary = await generateReply({
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
  } catch (err) {
    console.error('[conversation-summary] LLM call failed:', err);
    return {
      summary:                '',
      summarisedMessageCount: 0,
      shouldRefresh:          true,   // try again next turn
    };
  }

  // 5. Truncate to MAX_SUMMARY_CHARS
  if (summary.length > MAX_SUMMARY_CHARS) {
    summary = summary.slice(0, MAX_SUMMARY_CHARS - 50) + '\n[…summary truncated]';
  }

  // 6. Persist
  await prisma.assistantSession.update({
    where: { id: sessionId },
    data: {
      conversationSummary:    summary,
      summarisedMessageCount: oldMessages.length,
      summaryLastUpdatedAt:   new Date(),
    },
  });

  return {
    summary,
    summarisedMessageCount: oldMessages.length,
    shouldRefresh:          false,
  };
}

/**
 * Format the summary for inclusion in the system prompt. Returns an empty
 * string if there's no summary; otherwise a clearly labelled block the LLM
 * can reference.
 */
export function formatSummaryForPrompt(snapshot: ConversationSummarySnapshot): string {
  if (!snapshot.summary || snapshot.summary.trim().length === 0) return '';

  return [
    '',
    '=== PERSISTENT CONVERSATION CONTEXT ===',
    '(Auto-generated summary of earlier turns in this session — treat as authoritative',
    `for the user\'s stated preferences and plans. Covers ${snapshot.summarisedMessageCount} earlier messages.)`,
    '',
    snapshot.summary,
    '',
    '=== END PERSISTENT CONTEXT ===',
    '',
  ].join('\n');
}

// ── Convenience: load-or-refresh-in-background ────────────────────────────────
//
// Use this from assistant.service.ts. It returns the CURRENT summary
// immediately (so the user's reply isn't blocked) and kicks off a refresh
// in the background if one is needed. The next turn will pick up the
// fresher summary.

export async function getSummaryWithBackgroundRefresh(
  sessionId: string,
  userId:    string,
): Promise<ConversationSummarySnapshot> {
  const snap = await loadSummary(sessionId);

  if (snap.shouldRefresh) {
    // Fire-and-forget — log errors but don't block.
    refreshSummary(sessionId, userId).catch((err) => {
      console.error('[conversation-summary] background refresh failed:', err);
    });
  }

  return snap;
}