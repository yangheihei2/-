import { callDeepSeekChat } from "../deepseek/client";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type Provider = "deepseek" | "openai" | "doubao";

export type ChatRequest = {
  provider: Provider;
  model: string;
  messages: ChatMessage[];
  temperature: number;
  stream: boolean;
  response_format?: { type: "json_object" };
};

export type StreamChunkHandler = (chunk: string) => void;

export async function callChat(req: ChatRequest, onStreamChunk?: StreamChunkHandler) {
  if (req.provider === "deepseek") {
    return callDeepSeekChat(
      {
        messages: req.messages,
        model: req.model,
        temperature: req.temperature,
        stream: req.stream,
        response_format: req.response_format
      },
      onStreamChunk
    );
  }

  if (req.provider === "openai") {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY is not set");
    throw new Error("OpenAI provider not implemented yet (UI already supports switching).");
  }

  if (req.provider === "doubao") {
    const key = process.env.DOUBAO_API_KEY;
    if (!key) throw new Error("DOUBAO_API_KEY is not set");
    throw new Error("Doubao provider not implemented yet (UI already supports switching).");
  }

  throw new Error(`Unknown provider: ${req.provider}`);
}
