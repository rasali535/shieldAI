import fetch from 'cross-fetch';
import * as dotenv from 'dotenv';

dotenv.config();

const AIML_API_KEY = process.env.AIML_API_KEY;
const AIML_BASE_URL = 'https://api.aimlapi.com/v1/chat/completions';

export interface ChatCompletionOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: 'json_object' };
}

// ─────────────────────────────────────────────────────────────────
// Model registry
// ─────────────────────────────────────────────────────────────────
export const MODELS = {
  /** Fast, cheap — light triage & summaries */
  GPT4O_MINI:   'gpt-4o-mini',
  /** DeepSeek-V3: wide context (64k), strong reasoning, low cost */
  DEEPSEEK:     'deepseek/deepseek-chat',
  /** DeepSeek-R1: chain-of-thought reasoning for complex risk analysis */
  DEEPSEEK_R1:  'deepseek/deepseek-r1',
} as const;

// ─────────────────────────────────────────────────────────────────
// Core completion call
// ─────────────────────────────────────────────────────────────────
async function _call(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  options: ChatCompletionOptions = {}
): Promise<string> {
  const apiKey = AIML_API_KEY;
  if (!apiKey || apiKey === 'your_aiml_api_key') {
    console.warn('[AIML] API key not configured. Returning empty mock response.');
    return '';
  }

  const model       = options.model       ?? MODELS.DEEPSEEK;
  const temperature = options.temperature ?? 0.2;
  const max_tokens  = options.max_tokens  ?? 2048;

  const payload: any = { model, messages, temperature, max_tokens };
  if (options.response_format) payload.response_format = options.response_format;

  const response = await fetch(AIML_BASE_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AIML API (${model}) failed ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data.choices[0]?.message?.content || '';
}

// ─────────────────────────────────────────────────────────────────
// Public helpers
// ─────────────────────────────────────────────────────────────────

/**
 * General-purpose chat completion — defaults to DeepSeek-V3.
 * Drop-in replacement for the old `chatCompletion()`.
 */
export async function chatCompletion(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  options: ChatCompletionOptions = {}
): Promise<string> {
  return _call(messages, { model: MODELS.DEEPSEEK, ...options });
}

/**
 * DeepSeek-V3 — wide context (64k tokens), strong instruction following.
 * Best for: broad threat analysis, large document summarisation, enrichment extraction.
 */
export async function deepSeekCompletion(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  options: Omit<ChatCompletionOptions, 'model'> = {}
): Promise<string> {
  return _call(messages, { ...options, model: MODELS.DEEPSEEK });
}

/**
 * DeepSeek-R1 — chain-of-thought reasoning model.
 * Best for: nuanced risk scoring, compliance analysis, complex decisions.
 */
export async function deepSeekR1Completion(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  options: Omit<ChatCompletionOptions, 'model'> = {}
): Promise<string> {
  return _call(messages, { ...options, model: MODELS.DEEPSEEK_R1 });
}

/**
 * Run multiple AI completions in parallel and return all results.
 * Errors are caught per-call and returned as empty strings so one failure
 * doesn't kill the entire batch.
 */
export async function parallelCompletions(
  jobs: Array<{
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
    options?: ChatCompletionOptions;
    label?: string;
  }>
): Promise<string[]> {
  const results = await Promise.allSettled(
    jobs.map(job => _call(job.messages, { model: MODELS.DEEPSEEK, ...job.options }))
  );

  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    console.warn(`[AIML parallelCompletions] Job ${jobs[i].label ?? i} failed:`, (r as PromiseRejectedResult).reason?.message);
    return '';
  });
}
