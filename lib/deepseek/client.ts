export type DeepSeekMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type DeepSeekRequest = {
  messages: DeepSeekMessage[];
  model: string;
  temperature: number;
  stream: boolean;
  response_format?: { type: "json_object" };
};

export type StreamChunkHandler = (chunk: string) => void;

const DEFAULT_BASE_URL = "https://api.deepseek.com";

function getBaseUrl() {
  const raw = process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL;
  return raw.replace(/\/$/, "");
}

export async function callDeepSeekChat(
  request: DeepSeekRequest,
  onStreamChunk?: StreamChunkHandler
) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is not set");
  }
  const url = `${getBaseUrl()}/chat/completions`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(request)
  });

  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(`DeepSeek error: ${response.status} ${text}`);
  }

  if (!request.stream) {
    const json = await response.json();
    const content = json.choices?.[0]?.message?.content ?? "";
    return { content, raw: json };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const lines = part
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("data:"));
      for (const line of lines) {
        const data = line.replace(/^data:\s?/, "");
        if (data === "[DONE]") {
          return { content, raw: null };
        }
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content ?? "";
          if (delta) {
            content += delta;
            onStreamChunk?.(delta);
          }
        } catch (error) {
          continue;
        }
      }
    }
  }

  return { content, raw: null };
}
