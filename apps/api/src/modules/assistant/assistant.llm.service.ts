import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { AssistantIntent } from '@fpl/types';

export type SupportedLlmProvider = 'anthropic' | 'openai';

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface GenerateReplyParams {
  systemPrompt: string;
  messages: LlmMessage[];
  /** Drives factual-vs-conversational temperature selection. Optional for backwards compatibility. */
  intent?: AssistantIntent;
}


const FACTUAL_INTENTS: ReadonlySet<AssistantIntent> = new Set([
  'CAPTAINCY',
  'TRANSFER_ADVICE',
  'TRANSFER_EVALUATION',
  'PLAYER_COMPARISON',
  'BENCH_ORDER',
  'FORMATION_ADVICE',
  'CHIP_ADVICE',
  'INITIAL_SQUAD',
]);

const FACTUAL_TEMPERATURE = 0.25;
const CONVERSATIONAL_TEMPERATURE = 0.6;
const DEFAULT_TEMPERATURE = 0.4; // used when no intent is supplied

function resolveTemperature(intent?: AssistantIntent): number {
  if (!intent) return DEFAULT_TEMPERATURE;
  return FACTUAL_INTENTS.has(intent) ? FACTUAL_TEMPERATURE : CONVERSATIONAL_TEMPERATURE;
}

function getProvider(): SupportedLlmProvider {
  const provider = (process.env.LLM_PROVIDER ?? 'anthropic').toLowerCase();

  if (provider === 'anthropic' || provider === 'openai') {
    return provider;
  }

  throw new Error(`UNSUPPORTED_LLM_PROVIDER: ${provider}`);
}

function getAnthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY_MISSING');
  }

  return new Anthropic({ apiKey });
}

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY_MISSING');
  }

  return new OpenAI({ apiKey });
}

function getAnthropicModel() {
  return process.env.ANTHROPIC_MODEL ?? process.env.LLM_MODEL ?? 'claude-opus-4-5';
}

function getOpenAIModel() {
  return process.env.OPENAI_MODEL ?? process.env.LLM_MODEL ?? 'gpt-4o-mini';
}

const DEFAULT_MAX_TOKENS = process.env.LLM_MAX_TOKENS ? parseInt(process.env.LLM_MAX_TOKENS, 10) : 3000;

export async function generateReply(params: GenerateReplyParams): Promise<string> {
  const provider = getProvider();

  if (provider === 'anthropic') {
    return generateReplyWithAnthropic(params);
  }

  return generateReplyWithOpenAI(params);
}

async function generateReplyWithAnthropic(params: GenerateReplyParams): Promise<string> {
  const anthropic = getAnthropicClient();
  const model = getAnthropicModel();
  const temperature = resolveTemperature(params.intent);

  const response = await anthropic.messages.create({
    model,
    max_tokens: DEFAULT_MAX_TOKENS,
    temperature,
    system: params.systemPrompt,
    messages: params.messages,
  });

  const replyText = response.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as { type: 'text'; text: string }).text)
    .join('')
    .trim();

  if (!replyText) {
    throw new Error('EMPTY_LLM_RESPONSE');
  }

  return replyText;
}

async function generateReplyWithOpenAI(params: GenerateReplyParams): Promise<string> {
  const openai = getOpenAIClient();
  const model = getOpenAIModel();
  const temperature = resolveTemperature(params.intent);

  const response = await openai.responses.create({
    model,
    input: [
      { role: 'system', content: params.systemPrompt },
      ...params.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    ],
    max_output_tokens: DEFAULT_MAX_TOKENS,
    temperature,
  });

  const replyText =
    typeof response.output_text === 'string'
      ? response.output_text.trim()
      : '';

  if (!replyText) {
    throw new Error('EMPTY_LLM_RESPONSE');
  }

  return replyText;
}

export async function* generateReplyStream(
  params: GenerateReplyParams,
): AsyncGenerator<string> {
  const provider = getProvider();

  if (provider === 'anthropic') {
    yield* generateReplyStreamWithAnthropic(params);
    return;
  }

  yield* generateReplyStreamWithOpenAI(params);
}

async function* generateReplyStreamWithAnthropic(
  params: GenerateReplyParams,
): AsyncGenerator<string> {
  const anthropic = getAnthropicClient();
  const model = getAnthropicModel();
  const temperature = resolveTemperature(params.intent);

  const stream = await anthropic.messages.stream({
    model,
    max_tokens: DEFAULT_MAX_TOKENS,
    temperature,
    system: params.systemPrompt,
    messages: params.messages,
  });

  for await (const chunk of stream) {
    if (
      chunk.type === 'content_block_delta' &&
      chunk.delta.type === 'text_delta'
    ) {
      const delta = chunk.delta.text;
      if (delta) yield delta;
    }
  }
}

async function* generateReplyStreamWithOpenAI(
  params: GenerateReplyParams,
): AsyncGenerator<string> {
  const openai = getOpenAIClient();
  const model = getOpenAIModel();
  const temperature = resolveTemperature(params.intent);

  const stream = await openai.responses.stream({
    model,
    input: [
      { role: 'system', content: params.systemPrompt },
      ...params.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    ],
    max_output_tokens: DEFAULT_MAX_TOKENS,
    temperature,
  });

  for await (const event of stream) {
    if (event.type === 'response.output_text.delta' && event.delta) {
      yield event.delta;
    }
  }
}
