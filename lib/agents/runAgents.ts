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
import { callDeepSeekChat } from "../deepseek/client";

/**
 * Ultra-fast demo mode:
 * - Non-stream requests (more stable)
 * - Per-role timeout (default 25s)
 * - Emits "started" and "failed" messages so UI never looks stuck
 * - Can "early finalize" after Editor to show a result ASAP
 */

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

// ✅ Fast mode knobs
const ROLE_TIMEOUT_MS = 120000; // 120 seconds per role
const EARLY_FINALIZE_AFTER_EDITOR = false; // allow ProofChecker + Formalizer to run
const MAX_RETRIES_DEFAULT = 1; // fewer retries in demo mode

function extractJson(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in response");
  }
  const sliced = text.slice(start, end + 1);
  return JSON.parse(sliced);
}

function mergeIssues(existing: Issue[], incoming: Issue[]) {
  const map = new Map(existing.map((issue) => [issue.id, issue]));
  for (const issue of incoming) {
    map.set(issue.id, issue);
  }
  return Array.from(map.values());
}

function mergeFixes(existing: Fix[], incoming: Fix[]) {
  const map = new Map(existing.map((fix) => [fix.issueId, fix]));
  for (const fix of incoming) {
    map.set(fix.issueId, fix);
  }
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

function emitStarted(sessionId: string, role: AgentRole) {
  const msg: SessionMessage = {
    role,
    json: { status: "started" },
    createdAt: new Date().toISOString(),
    metadata: { durationMs: 0, retries: 0 }
  };
  updateSession(sessionId, (s) => ({ ...s, messages: [...s.messages, msg] }));
  emitEvent(sessionId, { type: "message", payload: msg });
}

function emitFailed(sessionId: string, role: AgentRole, err: string, durationMs: number, retries: number) {
  const msg: SessionMessage = {
    role,
    json: { status: "failed", error: err },
    createdAt: new Date().toISOString(),
    metadata: { durationMs, retries }
  };
  updateSession(sessionId, (s) => ({ ...s, messages: [...s.messages, msg] }));
  emitEvent(sessionId, { type: "message", payload: msg });

  // Also surface to error panel, but do NOT stop the whole run unless it's Prover.
  emitEvent(sessionId, { type: "error", payload: { message: `[${role}] ${err}` } });
}

async function runRole(role: AgentRole, state: SessionState) {
  const schema = AgentSchemas[role];

  const baseMessages = [
    { role: "system" as const, content: AgentPrompts[role] },
    { role: "user" as const, content: JSON.stringify(buildPayload(role, state)) }
  ];

  let lastError: Error | null = null;
  let lastOutput = "";
  const maxRetries = state.config.maxRetries ?? MAX_RETRIES_DEFAULT;
  const start = Date.now();

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const { content } = await callDeepSeekChat({
        messages: baseMessages,
        model: state.config.model,
        temperature: state.config.temperature,
        stream: false, // ✅ non-stream for stability
        response_format: { type: "json_object" },
        timeoutMs: ROLE_TIMEOUT_MS
      });

      const raw = (content ?? "").trim();
      lastOutput = raw;

      const parsed = extractJson(raw);
      const validated = schema.parse(parsed) as Record<string, unknown>;
      const durationMs = Date.now() - start;
      return { data: validated, durationMs, retries: attempt };
    } catch (error) {
      lastError = error as Error;
      baseMessages.push({
        role: "user",
        content: JSON.stringify({
          error: "Your previous output was invalid JSON or did not match the schema. Return valid JSON only.",
          previousOutput: lastOutput || lastError.message
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
    if (parsed.success) issues.push(parsed.data);
  }
  // Ensure sourceRole always exists (even if model forgets)
  return issues.map((i) => ({ ...i, sourceRole: i.sourceRole || role }));
}

function collectFixes(data: Record<string, unknown>) {
  const fixesRaw = Array.isArray(data.fixes) ? data.fixes : [];
  const fixes: Fix[] = [];
  for (const fix of fixesRaw) {
    const parsed = FixSchema.safeParse(fix);
    if (parsed.success) fixes.push(parsed.data);
  }
  return fixes;
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
  updateSession(sessionId, (s) => ({ ...s, status: "running", errorMessage: undefined }));

  try {
    const maxRounds = record.state.config.maxRounds || 1;

    for (let round = 1; round <= maxRounds; round += 1) {
      for (const role of ROLE_SEQUENCE) {
        const current = getSessionRecord(sessionId);
        if (!current) return;

        // ✅ UI feedback immediately
        emitStarted(sessionId, role);

        try {
          const { data, durationMs, retries } = await runRole(role, current.state);

          const message: SessionMessage = {
            role,
            json: data as Record<string, unknown>,
            createdAt: new Date().toISOString(),
            metadata: { durationMs, retries }
          };

          updateSession(sessionId, (s) => ({ ...s, messages: [...s.messages, message] }));
          emitEvent(sessionId, { type: "message", payload: message });

          function normalizeSeverity(input: unknown): "critical" | "major" | "minor" {
            const s = String(input ?? "").toLowerCase().trim();
            if (s === "high" || s === "blocker" || s === "fatal") return "critical";
            if (s === "medium" || s === "mid") return "major";
            if (s === "low" || s === "minor") return "minor";
            if (s === "critical" || s === "major" || s === "minor") return s as any;
            return "major";
          }
          
          function collectIssues(role: AgentRole, data: Record<string, unknown>) {
            const issuesRaw = Array.isArray((data as any).issues) ? (data as any).issues : [];
            const issues: Issue[] = [];
          
            for (const issue of issuesRaw) {
              // 先把严重程度修正再做 schema 校	printf
              const fixed = {
                ...issue,
                sourceRole: issue?.sourceRole || role,
                severity: normalizeSeverity(issue?.severity)
              };
          
              const parsed = IssueSchema.safeParse(fixed);
              if (parsed.success) issues.push(parsed.data);
            }
          
            return issues;
          }
          
          if (role === "Editor") {
            const parsed = EditorSchema.safeParse(data);
            updateSession(sessionId, (s) => ({
              ...s,
              finalProof: parsed.success ? parsed.data.finalProof : s.finalProof,
              finalProofLatex: parsed.success
                ? parsed.data.finalProofLatex ?? s.finalProofLatex
                : s.finalProofLatex
            }));

            // ✅ Early finalize: show result ASAP
            if (EARLY_FINALIZE_AFTER_EDITOR) {
              updateSession(sessionId, (s) => ({ ...s, status: "done" }));
              const finalState = getSessionRecord(sessionId);
              if (finalState) emitEvent(sessionId, { type: "done", payload: summarize(finalState.state) });
              setRunning(sessionId, false);
              return;
            }
          }

          if (role === "Formalizer") {
            const parsed = FormalizerSchema.safeParse(data);
            updateSession(sessionId, (s) => ({
              ...s,
              depsTable: parsed.success ? parsed.data.depsTable : s.depsTable
            }));
          }
        } catch (e) {
          const err = (e as Error).message || "Unknown error";
          const durationMs = ROLE_TIMEOUT_MS;
          const retries = record.state.config.maxRetries ?? MAX_RETRIES_DEFAULT;

          emitFailed(sessionId, role, err, durationMs, retries);

          // If Prover fails, the whole run is not meaningful -> stop
          if (role === "Prover") {
            updateSession(sessionId, (s) => ({ ...s, status: "error", errorMessage: err }));
            emitEvent(sessionId, { type: "error", payload: { message: err } });
            setRunning(sessionId, false);
            return;
          }

          // Otherwise continue to next role in demo mode
          continue;
        }
      }
    }

    updateSession(sessionId, (s) => ({ ...s, status: "done" }));
    const finalState = getSessionRecord(sessionId);
    if (finalState) emitEvent(sessionId, { type: "done", payload: summarize(finalState.state) });
  } finally {
    setRunning(sessionId, false);
  }
}
