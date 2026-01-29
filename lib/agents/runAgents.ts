import { callChat } from "../llm/client";
import {
  AgentPrompts,
  AgentRole,
  AgentSchemas,
  FixSchema,
  FixerSchema,
  IssueSchema,
  EditorSchema,
  FormalizerSchema
} from "./prompts";
import {
  emitEvent,
  getSessionRecord,
  isRunning,
  setRunning,
  updateSession,
  type Issue,
  type Fix,
  type SessionMessage,
  type SessionState
} from "../sessions/store";

const ROLE_SEQUENCE: AgentRole[] = [
  "Prover",
  "Skeptic",
  "CounterexampleHunter",
  "AssumptionAuditor",
  "Fixer",
  "NotationGuardian",
  "Editor",
  "ProofChecker",
  "Formalizer"
];

function parseModelJson(raw: string) {
  const trimmed = (raw ?? "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("No JSON object found in response");
    }
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

function mergeIssues(existing: Issue[], incoming: Issue[]) {
  const map = new Map(existing.map((issue) => [issue.id, issue]));
  for (const issue of incoming) map.set(issue.id, issue);
  return Array.from(map.values());
}

function mergeFixes(existing: Fix[], incoming: Fix[]) {
  const map = new Map(existing.map((fix) => [fix.issueId, fix]));
  for (const fix of incoming) map.set(fix.issueId, fix);
  return Array.from(map.values());
}

function buildPayload(role: AgentRole, state: SessionState) {
  return {
    role,
    theorem: state.theorem,
    assumptions: state.assumptions,
    draftProof: state.draftProof,
    config: state.config,
    issues: state.issues,
    fixes: state.fixes,
    finalProof: state.finalProof
  };
}

async function runRole(role: AgentRole, state: SessionState) {
  const schema = AgentSchemas[role];
  const baseMessages = [
    { role: "system" as const, content: AgentPrompts[role] },
    { role: "user" as const, content: JSON.stringify(buildPayload(role, state)) }
  ];

  let lastError: Error | null = null;
  let lastOutput = "";
  let retries = 0;
  const maxRetries = state.config.maxRetries ?? 2;
  const start = Date.now();

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    retries = attempt;
    try {
      let streamContent = "";
      const { content } = await callChat(
        {
          provider: state.config.provider,
          messages: baseMessages,
          model: state.config.model,
          temperature: state.config.temperature,
          stream: true,
          response_format: { type: "json_object" }
        },
        (delta) => {
          streamContent += delta;
        }
      );
      

      const raw = streamContent || content;
      lastOutput = raw;

      const parsed = parseModelJson(raw);
      const validated = schema.parse(parsed) as Record<string, unknown>;
      const durationMs = Date.now() - start;
      return { data: validated, durationMs, retries };
    } catch (error) {
      lastError = error as Error;
      baseMessages.push({
        role: "user",
        content: JSON.stringify({
          error: "Your previous output was invalid JSON or did not match the schema. Return valid JSON only.",
          previousOutput: lastOutput || (lastError as Error).message
        })
      });
    }
  }

  throw lastError ?? new Error("Failed to run role");
}

function collectIssues(role: AgentRole, data: Record<string, unknown>) {
  const issuesRaw = Array.isArray(data.issues) ? data.issues : [];
  const issues: Issue[] = [];
  for (const issue of issuesRaw) {
    const parsed = IssueSchema.safeParse(issue);
    if (parsed.success) issues.push(parsed.data as Issue);
  }
  return issues.map((issue) => ({ ...issue, sourceRole: issue.sourceRole || role }));
}

function collectFixes(data: Record<string, unknown>) {
  const fixesRaw = Array.isArray(data.fixes) ? data.fixes : [];
  const fixes: Fix[] = [];
  for (const fix of fixesRaw) {
    const parsed = FixSchema.safeParse(fix);
    if (parsed.success) fixes.push(parsed.data as Fix);
  }
  return fixes;
}

function hasOpenCriticalIssues(state: SessionState) {
  return state.issues.some(
    (issue) => issue.severity === "critical" && issue.status !== "resolved" && issue.status !== "invalid"
  );
}

function summarize(state: SessionState) {
  return {
    status: state.status,
    finalProof: state.finalProof,
    issueCount: state.issues.length,
    fixesCount: state.fixes.length
  };
}

export async function runSession(sessionId: string): Promise<void> {
  const record = getSessionRecord(sessionId);
  if (!record || isRunning(sessionId)) return;

  setRunning(sessionId, true);
  updateSession(sessionId, (state) => ({ ...state, status: "running" }));

  try {
    let round = 0;
    const maxRounds = record.state.config.maxRounds || 1;

    while (round < maxRounds) {
      round += 1;

      for (const role of ROLE_SEQUENCE) {
        const current = getSessionRecord(sessionId);
        if (!current) return;

        const { data, durationMs, retries } = await runRole(role, current.state);

        const message: SessionMessage = {
          role,
          json: data as Record<string, unknown>,
          createdAt: new Date().toISOString(),
          metadata: { durationMs, retries }
        };

        updateSession(sessionId, (state) => ({
          ...state,
          messages: [...state.messages, message]
        }));
        emitEvent(sessionId, { type: "message", payload: message });

        const issues = collectIssues(role, data as Record<string, unknown>);
        if (issues.length) {
          updateSession(sessionId, (state) => ({
            ...state,
            issues: mergeIssues(state.issues, issues)
          }));
          for (const issue of issues) {
            emitEvent(sessionId, { type: "issue", payload: issue });
          }
        }

        if (role === "Fixer") {
          const parsed = FixerSchema.safeParse(data);
          const fixes = collectFixes(data as Record<string, unknown>);
          updateSession(sessionId, (state) => ({
            ...state,
            fixes: mergeFixes(state.fixes, fixes),
            draftProof: parsed.success ? parsed.data.patchedProof : state.draftProof
          }));
        }

        if (role === "Editor") {
          const parsed = EditorSchema.safeParse(data);
          updateSession(sessionId, (state) => ({
            ...state,
            finalProof: parsed.success ? parsed.data.finalProof : state.finalProof
          }));
        }

        if (role === "Formalizer") {
          const parsed = FormalizerSchema.safeParse(data);
          updateSession(sessionId, (state) => ({
            ...state,
            depsTable: parsed.success ? parsed.data.depsTable : state.depsTable
          }));
        }
      }

      const snapshot = getSessionRecord(sessionId);
      if (!snapshot) return;
      if (!hasOpenCriticalIssues(snapshot.state)) break;
    }

    updateSession(sessionId, (state) => ({ ...state, status: "done" }));
    const finalState = getSessionRecord(sessionId);
    if (finalState) {
      emitEvent(sessionId, { type: "done", payload: summarize(finalState.state) });
    }
  } catch (error) {
    updateSession(sessionId, (state) => ({
      ...state,
      status: "error",
      errorMessage: (error as Error).message
    }));
    emitEvent(sessionId, { type: "error", payload: { message: (error as Error).message } });
  } finally {
    setRunning(sessionId, false);
  }
}
