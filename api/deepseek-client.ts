const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const REQUEST_TIMEOUT_MS = 55000;
const MAX_RETRIES = 2;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

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
        const shouldRetry = response.status === 408 || response.status === 429 || response.status >= 500;
        if (shouldRetry && attempt < MAX_RETRIES) {
          await sleep(600 * (attempt + 1));
          continue;
        }
        throw new Error(lastError);
      }

      const data = rawText ? JSON.parse(rawText) : {};
      return data;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        lastError = `DeepSeek request timed out after ${REQUEST_TIMEOUT_MS / 1000}s.`;
      } else {
        lastError = error instanceof Error ? error.message : 'Unknown DeepSeek request error.';
      }

      if (attempt < MAX_RETRIES) {
        await sleep(600 * (attempt + 1));
        continue;
      }

      throw new Error(lastError);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(lastError);
}
