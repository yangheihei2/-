const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const REQUEST_TIMEOUT_MS_DEFAULT = 90000;
const MAX_RETRIES = 1;
const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429]);
const REQUEST_TIMEOUT_MS_MIN = 30000;
const REQUEST_TIMEOUT_MS_MAX = 300000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));


function getRequestTimeoutMs(model: string) {
  const configured = Number(process.env.DEEPSEEK_REQUEST_TIMEOUT_MS || '');
  const baseTimeout = Number.isFinite(configured)
    ? Math.floor(configured)
    : REQUEST_TIMEOUT_MS_DEFAULT;

  const needsExtraTime = model === 'deepseek-reasoner' || model === 'deepseek-v4-pro';
  const withModelFactor = needsExtraTime ? Math.floor(baseTimeout * 1.5) : baseTimeout;

  return Math.min(REQUEST_TIMEOUT_MS_MAX, Math.max(REQUEST_TIMEOUT_MS_MIN, withModelFactor));
}

interface DeepSeekCallParams {
  apiKey: string;
  model: string;
  messages: Array<{ role: 'user' | 'system' | 'assistant'; content: string }>;
  temperature?: number;
}

export async function callDeepSeek({ apiKey, model, messages, temperature }: DeepSeekCallParams) {
  let lastError = 'DeepSeek request failed.';

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const requestTimeoutMs = getRequestTimeoutMs(model);
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

    try {
      const body: Record<string, unknown> = {
        model,
        messages,
      };

      // deepseek-reasoner uses fixed sampling params and may reject temperature/top_p.
      if (model !== 'deepseek-reasoner' && typeof temperature === 'number') {
        body.temperature = temperature;
      }

      const response = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const rawText = await response.text();

      if (!response.ok) {
        lastError = `DeepSeek API error ${response.status}: ${rawText || 'No response body.'}`;
        const shouldRetry = RETRYABLE_STATUS_CODES.has(response.status) || response.status >= 500;
        if (shouldRetry && attempt < MAX_RETRIES) {
          await sleep(1000 * (attempt + 1));
          continue;
        }
        throw new Error(lastError);
      }

      const data = rawText ? JSON.parse(rawText) : {};
      return data;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        lastError = `DeepSeek request timed out after ${requestTimeoutMs / 1000}s.`;
      } else {
        lastError = error instanceof Error ? error.message : 'Unknown DeepSeek request error.';
      }

      if (attempt < MAX_RETRIES) {
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
