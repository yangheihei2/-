export type OpenAIMessage = {
    role: "system" | "user" | "assistant";
    content: string;
  };
  
  export type OpenAIRequest = {
    messages: OpenAIMessage[];
    model: string;
    temperature: number;
    stream: boolean;
    response_format?: { type: "json_object" };
    timeoutMs?: number;
  };
  
  export type StreamChunkHandler = (chunk: string) => void;
  
  const OPENAI_BASE_URL = "https://api.openai.com/v1";
  
  export async function callOpenAIChat(
    request: OpenAIRequest,
    onStreamChunk?: StreamChunkHandler
  ) {
    const timeoutMs = request.timeoutMs ?? 120000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
  
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      clearTimeout(timeout);
      throw new Error("OPENAI_API_KEY is not set");
    }
  
    const url = `${OPENAI_BASE_URL}/chat/completions`;
  
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          temperature: request.temperature,
          stream: request.stream,
          response_format: request.response_format
        }),
        signal: controller.signal
      });
    } catch (e) {
      clearTimeout(timeout);
      throw e;
    }
  
    if (!response.ok || !response.body) {
      const text = await response.text();
      clearTimeout(timeout);
      throw new Error(`OpenAI error: ${response.status} ${text}`);
    }
  
    // non-stream
    if (!request.stream) {
      const json = await response.json();
      const content = json.choices?.[0]?.message?.content ?? "";
      clearTimeout(timeout);
      return { content, raw: json };
    }
  
    // stream: SSE style
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
  
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
  
        buffer += decoder.decode(value, { stream: true });
  
        // OpenAI stream uses \n lines with "data: {...}"
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
  
        for (const lineRaw of lines) {
          const line = lineRaw.trim();
          if (!line.startsWith("data:")) continue;
  
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
          } catch {
            // ignore bad chunk
          }
        }
      }
    } finally {
      clearTimeout(timeout);
    }
  
    return { content, raw: null };
  }
  