import { AgentRole } from "../agents/prompts";

export type Issue = {
  id: string;
  sourceRole: string;
  severity: "critical" | "major" | "minor";
  claim: string;
  location: string;
  why_wrong: string;
  fix_hint: string;
  status: "open" | "resolved" | "needs_assumption" | "invalid";
};

export type Fix = {
  issueId: string;
  response: string;
  status: "resolved" | "needs_assumption" | "cannot_fix";
  patchSummary: string;
};

export type SessionMessage = {
  role: AgentRole;
  json: Record<string, unknown>;
  createdAt: string;
  metadata?: {
    durationMs?: number;
    retries?: number;
  };
};

export type SessionState = {
  id: string;
  theorem: string;
  assumptions: string;
  draftProof: string;
  config: {
    provider: "deepseek" | "openai" | "doubao";
    model: string;
    temperature: number;
    maxRounds: number;
    maxRetries: number;
    thinkingMode?: boolean;
  };
  
  messages: SessionMessage[];
  issues: Issue[];
  fixes: Fix[];
  finalProof: string;
  depsTable: Array<Record<string, unknown>>;
  status: "idle" | "running" | "done" | "error";
  errorMessage?: string;
};

export type StreamEvent =
  | { type: "message"; payload: SessionMessage }
  | { type: "issue"; payload: Issue }
  | { type: "done"; payload: Partial<SessionState> }
  | { type: "error"; payload: { message: string } };

type Listener = (event: StreamEvent) => void;

type SessionRecord = {
  state: SessionState;
  listeners: Set<Listener>;
  running: boolean;
};

const sessions = new Map<string, SessionRecord>();

export function createSession(state: SessionState) {
  sessions.set(state.id, {
    state,
    listeners: new Set(),
    running: false
  });
}

export function getSessionRecord(id: string) {
  return sessions.get(id);
}

export function updateSession(id: string, updater: (state: SessionState) => SessionState) {
  const record = sessions.get(id);
  if (!record) return null;
  record.state = updater(record.state);
  return record.state;
}

export function emitEvent(id: string, event: StreamEvent) {
  const record = sessions.get(id);
  if (!record) return;
  for (const listener of record.listeners) {
    listener(event);
  }
}

export function addListener(id: string, listener: Listener) {
  const record = sessions.get(id);
  if (!record) return () => {};
  record.listeners.add(listener);
  return () => {
    record.listeners.delete(listener);
  };
}

export function setRunning(id: string, running: boolean) {
  const record = sessions.get(id);
  if (!record) return;
  record.running = running;
}

export function isRunning(id: string) {
  return sessions.get(id)?.running ?? false;
}

export function listSessions() {
  return sessions;
}
