"use client";

import { useMemo } from "react";

export type TimelineMessage = {
  role: string;
  json: Record<string, unknown>;
  createdAt: string;
  metadata?: {
    durationMs?: number;
    retries?: number;
  };
};

function summarize(role: string, json: Record<string, unknown>) {
  if (role === "Prover") return String(json.proofStrategySummary ?? "");
  if (role === "Skeptic") return String(json.overallAssessment ?? "");
  if (role === "Fixer") return `fixes=${Array.isArray(json.fixes) ? json.fixes.length : 0}`;
  if (role === "Editor") return `finalProof ready`;
  if (role === "ProofChecker") return `issues=${Array.isArray(json.issues) ? json.issues.length : 0}`;
  if (role === "Formalizer") return `deps=${Array.isArray(json.depsTable) ? json.depsTable.length : 0}`;
  return "";
}

export default function Timeline({
  messages,
  compact = false
}: {
  messages: TimelineMessage[];
  compact?: boolean;
}) {
  const sorted = useMemo(
    () => [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [messages]
  );

  // compact: keep only the last message per role
  const list = useMemo(() => {
    if (!compact) return sorted;
    const map = new Map<string, TimelineMessage>();
    for (const m of sorted) map.set(m.role, m);
    return Array.from(map.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [sorted, compact]);

  return (
    <div className="card">
      <div className="cardHeader">
        <div className="cardTitleRow">
          <h2>Run Log</h2>
          <div className="hint">
            {compact
              ? "Compact mode: only the final output of each agent is shown."
              : "Full execution log."}
          </div>
        </div>
        <span className="badge">{list.length} entries</span>
      </div>

      {list.length === 0 && <p className="muted">Waiting for execution logs…</p>}

      {list.map((m, idx) => {
        const sum = summarize(m.role, m.json);
        return (
          <div className="timeline-item" key={`${m.role}-${idx}`}>
            <header>
              <strong>{m.role}</strong>
              <span className="badge">
                {new Date(m.createdAt).toLocaleTimeString()}
              </span>
            </header>

            <p className="muted" style={{ marginTop: 6 }}>
              {m.metadata?.durationMs ? `Time ${m.metadata.durationMs}ms` : ""}
              {m.metadata?.retries ? ` · Retries ${m.metadata.retries}` : ""}
              {sum ? ` · ${sum}` : ""}
            </p>

            <details style={{ marginTop: 8 }}>
              <summary className="muted">View raw JSON</summary>
              <pre className="proof-pre">{JSON.stringify(m.json, null, 2)}</pre>
            </details>
          </div>
        );
      })}
    </div>
  );
}
