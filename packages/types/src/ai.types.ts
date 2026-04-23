export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id:        string;
  role:      ChatRole;
  content:   string;
  createdAt: string;   // ISO date string
}

// ── Chat request / response ───────────────────────────────────────────────────

/** POST /ai/chat */
export interface ChatRequest {
  message:    string;
  /** Conversation history to maintain context */
  history?:   Pick<ChatMessage, 'role' | 'content'>[];
  /** Inject current squad context so the AI can give personalised advice */
  context?:   AiContext;
}

/** Streamed delta chunk (Server-Sent Events) */
export interface ChatStreamChunk {
  delta:    string;    // partial text
  done:     boolean;
}

/** Non-streamed full response */
export interface ChatResponse {
  message:  ChatMessage;
}

// ── AI Context ────────────────────────────────────────────────────────────────
// Injected into the system prompt so the AI knows the user's squad state.

export interface AiContext {
  gameweek:        number;
  teamName:        string;
  bank:            number;    // available bank in tenths of £m
  freeTransfers:   number;
  /** Condensed squad — webName + position + cost + GW points */
  squad: Array<{
    webName:     string;
    position:    string;   // "GK" | "DEF" | "MID" | "FWD"
    club:        string;
    nowCost:     number;
    totalPoints: number | null;
    isCaptain:   boolean;
    isOnBench:   boolean;
  }>;
}

// ── Suggestion types ──────────────────────────────────────────────────────────
// Structured suggestions the AI can return alongside free text.

export type SuggestionType =
  | 'TRANSFER'
  | 'CAPTAIN_PICK'
  | 'CHIP_ADVICE'
  | 'BENCH_ORDER';

export interface AiSuggestion {
  type:     SuggestionType;
  title:    string;
  body:     string;
  /** Optional player IDs referenced in the suggestion */
  players?: number[];
}
