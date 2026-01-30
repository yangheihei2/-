import { NextResponse } from "next/server";
import { createSession, type SessionState } from "../../../lib/sessions/store";
import { runSession } from "../../../lib/agents/runAgents";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json();
  const { theorem, assumptions, draftProof, config } = body ?? {};
  const sessionId = crypto.randomUUID();

  const session: SessionState = {
    id: sessionId,
    theorem: theorem ?? "",
    assumptions: assumptions ?? "",
    draftProof: draftProof ?? "",
    config: {
      provider: config?.provider ?? "deepseek",
      model: config?.model ?? "deepseek-chat",
      temperature: config?.temperature ?? 0.2,
      maxRounds: config?.maxRounds ?? 1,
      maxRetries: config?.maxRetries ?? 2,
      thinkingMode: config?.thinkingMode ?? false
    },
    messages: [],
    issues: [],
    fixes: [],
    finalProof: "",
    finalProofLatex: "",
    depsTable: [],
    status: "idle"
  };

  createSession(session);
  void runSession(sessionId);

  return NextResponse.json({ sessionId });
}
