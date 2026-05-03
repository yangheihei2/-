import { callDeepSeek } from './deepseek-client.js';
import { callGemini } from './gemini-client.js';
import { resolveModelOption } from './model-config.js';

interface AiCallParams {
  model: string;
  messages: Array<{ role: 'user' | 'system' | 'assistant'; content: string }>;
  temperature?: number;
  requestTimeoutMs?: number;
  maxRetries?: number;
}

export function getApiKeyForModel(model: string) {
  const option = resolveModelOption(model);
  if (option.provider === 'gemini') {
    return {
      provider: option.provider,
      apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
      missingKeyError: 'Server env GEMINI_API_KEY is not configured.',
      missingKeyCode: 'GEMINI_KEY_MISSING',
      userHint: 'Please configure GEMINI_API_KEY on the server before using Gemini models, including free-tier Gemini models.',
    };
  }

  return {
    provider: option.provider,
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    missingKeyError: 'Server env DEEPSEEK_API_KEY is not configured.',
    missingKeyCode: 'DEEPSEEK_KEY_MISSING',
    userHint: 'Please configure DEEPSEEK_API_KEY on the server before using DeepSeek models.',
  };
}

export async function callAiModel({ model, messages, temperature, requestTimeoutMs, maxRetries }: AiCallParams) {
  const option = resolveModelOption(model);
  const keyInfo = getApiKeyForModel(option.id);

  if (!keyInfo.apiKey) {
    const error = new Error(keyInfo.missingKeyError);
    Object.assign(error, {
      errorCode: keyInfo.missingKeyCode,
      userHint: keyInfo.userHint,
      provider: keyInfo.provider,
    });
    throw error;
  }

  if (option.provider === 'gemini') {
    return callGemini({
      apiKey: keyInfo.apiKey,
      model: option.id,
      messages,
      temperature,
      requestTimeoutMs,
      maxRetries,
    });
  }

  return callDeepSeek({
    apiKey: keyInfo.apiKey,
    model: option.id,
    messages,
    temperature,
    requestTimeoutMs,
    maxRetries,
  });
}

export function formatProviderName(model: string) {
  return resolveModelOption(model).provider === 'gemini' ? 'Gemini' : 'DeepSeek';
}
