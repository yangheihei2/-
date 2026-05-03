const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const REQUEST_TIMEOUT_MS_DEFAULT = 90000;
const REQUEST_TIMEOUT_MS_MIN = 30000;
const REQUEST_TIMEOUT_MS_MAX = 300000;
const MAX_RETRIES = 1;
const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface GeminiCallParams {
  apiKey: string;
  model: string;
  messages: Array<{ role: 'user' | 'system' | 'assistant'; content: string }>;
  temperature?: number;
  requestTimeoutMs?: number;
  maxRetries?: number;
}

function clampTimeoutMs(value: number) {
  return Math.min(REQUEST_TIMEOUT_MS_MAX, Math.max(REQUEST_TIMEOUT_MS_MIN, Math.floor(value)));
}

function buildGeminiBody(messages: GeminiCallParams['messages'], temperature?: number) {
  const systemText = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n')
    .trim();

  const contents = messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    }));

  const body: Record<string, unknown> = {
    contents: contents.length > 0 ? contents : [{ role: 'user', parts: [{ text: '' }] }],
  };

  if (systemText) {
    body.systemInstruction = { parts: [{ text: systemText }] };
  }

  if (typeof temperature === 'number') {
    body.generationConfig = { temperature };
  }

  return body;
}

function extractGeminiText(data: any) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('')
    .trim();
}

export async function callGemini({
  apiKey,
  model,
  messages,
  temperature,
  requestTimeoutMs,
  maxRetries = MAX_RETRIES,
}: GeminiCallParams) {
  let lastError = 'Gemini request failed.';
  const timeoutMs = clampTimeoutMs(requestTimeoutMs ?? REQUEST_TIMEOUT_MS_DEFAULT);

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${GEMINI_API_BASE_URL}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildGeminiBody(messages, temperature)),
        signal: controller.signal,
      });

      const rawText = await response.text();
      if (!response.ok) {
        lastError = `Gemini API error ${response.status}: ${rawText || 'No response body.'}`;
        const shouldRetry = RETRYABLE_STATUS_CODES.has(response.status) || response.status >= 500;
        if (shouldRetry && attempt < maxRetries) {
          await sleep(1000 * (attempt + 1));
          continue;
        }
        throw new Error(lastError);
      }

      const data = rawText ? JSON.parse(rawText) : {};
      return {
        ...data,
        choices: [{ message: { content: extractGeminiText(data) } }],
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        lastError = `Gemini request timed out after ${timeoutMs / 1000}s.`;
      } else {
        lastError = error instanceof Error ? error.message : 'Unknown Gemini request error.';
      }

      if (attempt < maxRetries) {
        await sleep(1000 * (attempt + 1));
        continue;
      }

      throw new Error(lastError);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(lastError);
}
