import fetch from 'cross-fetch';
import * as dotenv from 'dotenv';

dotenv.config();

const AIML_API_KEY = process.env.AIML_API_KEY;

export interface ChatCompletionOptions {
  model?: string;
  temperature?: number;
  response_format?: { type: 'json_object' };
}

/**
 * Call the AI/ML API to get chat completions.
 * Supports standard OpenAI models (e.g. gpt-4o, gpt-4o-mini, meta-llama/llama-3-70b-instruct)
 */
export async function chatCompletion(
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  options: ChatCompletionOptions = {}
): Promise<string> {
  const apiKey = AIML_API_KEY;
  if (!apiKey || apiKey === 'your_aiml_api_key') {
    console.warn('AIML_API_KEY not configured or using placeholder. Returning mock response.');
    return '';
  }

  const model = options.model || 'gpt-4o-mini';
  const temperature = options.temperature ?? 0.2;
  
  const payload: any = {
    model,
    messages,
    temperature,
  };

  if (options.response_format) {
    payload.response_format = options.response_format;
  }

  const response = await fetch('https://api.aimlapi.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI/ML API call failed with status ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data.choices[0]?.message?.content || '';
}
