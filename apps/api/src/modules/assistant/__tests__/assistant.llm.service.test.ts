import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Shared mock method objects — modified per test via mockResolvedValue etc.
const mockAnthropicMessages = { create: vi.fn(), stream: vi.fn() };
const mockOpenAIResponses   = { create: vi.fn(), stream: vi.fn() };

// Use `class` so `new Anthropic(...)` and `new OpenAI(...)` work correctly
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = mockAnthropicMessages;
  },
}));

vi.mock('openai', () => ({
  default: class MockOpenAI {
    responses = mockOpenAIResponses;
  },
}));

import { generateReply, generateReplyStream } from '../assistant.llm.service.js';

const PARAMS = {
  systemPrompt: 'You are CoachBot.',
  messages: [{ role: 'user' as const, content: 'who to captain?' }],
};

// ── Provider selection ────────────────────────────────────────────────────────

describe('provider selection', () => {

  afterEach(() => {
    delete process.env.LLM_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    vi.clearAllMocks();
  });

  it('throws UNSUPPORTED_LLM_PROVIDER for unknown provider value', async () => {
    process.env.LLM_PROVIDER   = 'gemini';
    process.env.OPENAI_API_KEY = 'sk-test';
    await expect(generateReply(PARAMS)).rejects.toThrow('UNSUPPORTED_LLM_PROVIDER');
  });

  it('throws ANTHROPIC_API_KEY_MISSING when provider is anthropic and key is absent', async () => {
    process.env.LLM_PROVIDER = 'anthropic';
    delete process.env.ANTHROPIC_API_KEY;
    await expect(generateReply(PARAMS)).rejects.toThrow('ANTHROPIC_API_KEY_MISSING');
  });

  it('throws OPENAI_API_KEY_MISSING when provider is openai and key is absent', async () => {
    process.env.LLM_PROVIDER = 'openai';
    delete process.env.OPENAI_API_KEY;
    await expect(generateReply(PARAMS)).rejects.toThrow('OPENAI_API_KEY_MISSING');
  });
});

// ── generateReply — Anthropic ─────────────────────────────────────────────────

describe('generateReply — Anthropic', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LLM_PROVIDER      = 'anthropic';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.ANTHROPIC_MODEL   = 'claude-haiku-4-5-20251001';
  });

  afterEach(() => {
    delete process.env.LLM_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_MODEL;
  });

  it('returns text from the Anthropic response', async () => {
    mockAnthropicMessages.create.mockResolvedValue({
      content: [{ type: 'text', text: 'Captain Salah.' }],
    });
    expect(await generateReply(PARAMS)).toBe('Captain Salah.');
  });

  it('joins multiple text blocks', async () => {
    mockAnthropicMessages.create.mockResolvedValue({
      content: [{ type: 'text', text: 'Captain ' }, { type: 'text', text: 'Salah.' }],
    });
    expect(await generateReply(PARAMS)).toBe('Captain Salah.');
  });

  it('throws EMPTY_LLM_RESPONSE when content is empty', async () => {
    mockAnthropicMessages.create.mockResolvedValue({ content: [] });
    await expect(generateReply(PARAMS)).rejects.toThrow('EMPTY_LLM_RESPONSE');
  });

  it('throws EMPTY_LLM_RESPONSE when text blocks are all empty strings', async () => {
    mockAnthropicMessages.create.mockResolvedValue({
      content: [{ type: 'text', text: '' }],
    });
    await expect(generateReply(PARAMS)).rejects.toThrow('EMPTY_LLM_RESPONSE');
  });

  it('ignores non-text content blocks', async () => {
    mockAnthropicMessages.create.mockResolvedValue({
      content: [
        { type: 'tool_use', id: 'tool_1', name: 'search', input: {} },
        { type: 'text', text: 'Captain Salah.' },
      ],
    });
    expect(await generateReply(PARAMS)).toBe('Captain Salah.');
  });

  it('passes system prompt and messages to the API', async () => {
    mockAnthropicMessages.create.mockResolvedValue({
      content: [{ type: 'text', text: 'reply' }],
    });
    await generateReply(PARAMS);
    expect(mockAnthropicMessages.create).toHaveBeenCalledWith(
      expect.objectContaining({ system: 'You are CoachBot.', messages: PARAMS.messages }),
    );
  });
});

// ── generateReply — OpenAI ────────────────────────────────────────────────────

describe('generateReply — OpenAI', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LLM_PROVIDER   = 'openai';
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.OPENAI_MODEL   = 'gpt-4o-mini';
  });

  afterEach(() => {
    delete process.env.LLM_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;
  });

  it('returns output_text from OpenAI response', async () => {
    mockOpenAIResponses.create.mockResolvedValue({ output_text: 'Captain Haaland.' });
    expect(await generateReply(PARAMS)).toBe('Captain Haaland.');
  });

  it('throws EMPTY_LLM_RESPONSE for empty output_text', async () => {
    mockOpenAIResponses.create.mockResolvedValue({ output_text: '' });
    await expect(generateReply(PARAMS)).rejects.toThrow('EMPTY_LLM_RESPONSE');
  });

  it('throws EMPTY_LLM_RESPONSE for null output_text', async () => {
    mockOpenAIResponses.create.mockResolvedValue({ output_text: null });
    await expect(generateReply(PARAMS)).rejects.toThrow('EMPTY_LLM_RESPONSE');
  });

  it('trims whitespace from output_text', async () => {
    mockOpenAIResponses.create.mockResolvedValue({ output_text: '  Captain Haaland.  ' });
    expect(await generateReply(PARAMS)).toBe('Captain Haaland.');
  });

  it('includes system prompt as first input message', async () => {
    mockOpenAIResponses.create.mockResolvedValue({ output_text: 'reply' });
    await generateReply(PARAMS);
    const call = mockOpenAIResponses.create.mock.calls[0][0];
    expect(call.input[0]).toEqual({ role: 'system', content: 'You are CoachBot.' });
  });
});

// ── generateReplyStream — Anthropic ──────────────────────────────────────────

describe('generateReplyStream — Anthropic', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LLM_PROVIDER      = 'anthropic';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  });

  afterEach(() => {
    delete process.env.LLM_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('yields delta chunks from the stream', async () => {
    async function* makeStream() {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Cap' } };
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'tain.' } };
      yield { type: 'message_stop' };
    }
    mockAnthropicMessages.stream.mockReturnValue(makeStream());
    const deltas: string[] = [];
    for await (const d of generateReplyStream(PARAMS)) deltas.push(d);
    expect(deltas).toEqual(['Cap', 'tain.']);
  });

  it('skips non-text-delta event types', async () => {
    async function* makeStream() {
      yield { type: 'message_start' };
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } };
      yield { type: 'message_delta' };
    }
    mockAnthropicMessages.stream.mockReturnValue(makeStream());
    const deltas: string[] = [];
    for await (const d of generateReplyStream(PARAMS)) deltas.push(d);
    expect(deltas).toEqual(['Hello']);
  });
});

// ── generateReplyStream — OpenAI ─────────────────────────────────────────────

describe('generateReplyStream — OpenAI', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LLM_PROVIDER   = 'openai';
    process.env.OPENAI_API_KEY = 'sk-test';
  });

  afterEach(() => {
    delete process.env.LLM_PROVIDER;
    delete process.env.OPENAI_API_KEY;
  });

  it('yields delta text from OpenAI stream events', async () => {
    async function* makeStream() {
      yield { type: 'response.output_text.delta', delta: 'Cap' };
      yield { type: 'response.output_text.delta', delta: 'tain.' };
      yield { type: 'response.completed' };
    }
    mockOpenAIResponses.stream.mockReturnValue(makeStream());
    const deltas: string[] = [];
    for await (const d of generateReplyStream(PARAMS)) deltas.push(d);
    expect(deltas).toEqual(['Cap', 'tain.']);
  });

  it('skips events with empty delta text', async () => {
    async function* makeStream() {
      yield { type: 'response.output_text.delta', delta: '' };
      yield { type: 'response.output_text.delta', delta: 'Hello' };
    }
    mockOpenAIResponses.stream.mockReturnValue(makeStream());
    const deltas: string[] = [];
    for await (const d of generateReplyStream(PARAMS)) deltas.push(d);
    expect(deltas).toEqual(['Hello']);
  });
});