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
  if (!sessionId) return new Response("Missing sessionId", { status: 400 });

  // ✅ Avoid race: run can be created right before stream connects
  let record = getSessionRecord(sessionId);
  if (!record) {
    await new Promise((r) => setTimeout(r, 150));
    record = getSessionRecord(sessionId);
  }
  if (!record) return new Response("Session not found", { status: 404 });

  // ✅ If not running yet, start it
  if (!isRunning(sessionId) && record.state.status === "idle") {
    void runSession(sessionId);
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: StreamEvent) => {
        if (event.type === "message") {
          controller.enqueue(encoder.encode(formatSse("message", event.payload)));
        } else if (event.type === "issue") {
          controller.enqueue(encoder.encode(formatSse("issue", event.payload)));
        } else if (event.type === "paper-proof") {
          controller.enqueue(encoder.encode(formatSse("paper-proof", event.payload)));
        } else if (event.type === "done") {
          controller.enqueue(encoder.encode(formatSse("done", event.payload)));
          controller.close();
        } else if (event.type === "error") {
          controller.enqueue(encoder.encode(formatSse("error", event.payload)));
          controller.close();
        }
      };

      // ✅ Replay existing messages/issues (in case user refreshes)
      for (const message of record!.state.messages) {
        controller.enqueue(encoder.encode(formatSse("message", message)));
      }
      for (const issue of record!.state.issues) {
        controller.enqueue(encoder.encode(formatSse("issue", issue)));
      }
      if (record!.state.paperProofStatus && record!.state.paperProofStatus !== "idle") {
        controller.enqueue(
          encoder.encode(
            formatSse("paper-proof", {
              status: record!.state.paperProofStatus,
              proof: record!.state.paperProof,
              usedPapers: record!.state.paperSources,
              error: record!.state.paperProofError
            })
          )
        );
      }

      // ✅ If already done, return immediately
      if (record!.state.status === "done") {
        controller.enqueue(
          encoder.encode(
            formatSse("done", { status: "done", finalProof: record!.state.finalProof })
          )
        );
        controller.close();
        return;
      }

      // ✅ Subscribe live events
      const unsubscribe = addListener(sessionId, send);

      // Optional: a connected event (front-end can ignore)
      controller.enqueue(encoder.encode(formatSse("connected", { sessionId })));

      request.signal.addEventListener("abort", () => {
        unsubscribe();
      });
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
