import { runSession } from "../../../lib/agents/runAgents";
import {
  addListener,
  getSessionRecord,
  isRunning,
  type StreamEvent
} from "../../../lib/sessions/store";

export const runtime = "nodejs";

function formatSse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  if (!sessionId) {
    return new Response("Missing sessionId", { status: 400 });
  }

  const record = getSessionRecord(sessionId);
  if (!record) {
    return new Response("Session not found", { status: 404 });
  }

  if (!isRunning(sessionId) && record.state.status === "idle") {
    void runSession(sessionId);
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: StreamEvent) => {
        if (event.type === "message") {
          controller.enqueue(encoder.encode(formatSse("message", event.payload)));
        }
        if (event.type === "issue") {
          controller.enqueue(encoder.encode(formatSse("issue", event.payload)));
        }
        if (event.type === "done") {
          controller.enqueue(encoder.encode(formatSse("done", event.payload)));
          controller.close();
        }
        if (event.type === "error") {
          controller.enqueue(encoder.encode(formatSse("error", event.payload)));
          controller.close();
        }
      };

      for (const message of record.state.messages) {
        controller.enqueue(encoder.encode(formatSse("message", message)));
      }
      for (const issue of record.state.issues) {
        controller.enqueue(encoder.encode(formatSse("issue", issue)));
      }

      if (record.state.status === "done") {
        controller.enqueue(
          encoder.encode(formatSse("done", { status: "done", finalProof: record.state.finalProof }))
        );
        controller.close();
        return;
      }

      const unsubscribe = addListener(sessionId, send);
      controller.enqueue(encoder.encode(formatSse("connected", { sessionId })));

      const close = () => {
        unsubscribe();
      };

      request.signal.addEventListener("abort", close);
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    }
  });
}
