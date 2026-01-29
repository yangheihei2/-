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

export default function Timeline({ messages }: { messages: TimelineMessage[] }) {
  const sorted = useMemo(
    () => [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [messages]
  );

  return (
    <div className="card">
      <h2>Timeline</h2>
      {sorted.length === 0 && <p className="muted">Waiting for run logs...</p>}
      {sorted.map((message, index) => (
        <div className="timeline-item" key={`${message.role}-${index}`}>
          <header>
            <strong>{message.role}</strong>
            <span className="badge">{new Date(message.createdAt).toLocaleTimeString()}</span>
          </header>
          <p className="muted">
            {message.metadata?.durationMs ? `Duration ${message.metadata.durationMs}ms` : ""}
            {message.metadata?.retries ? ` · Retries ${message.metadata.retries}` : ""}
          </p>
          <details>
            <summary className="muted">Expand JSON</summary>
            <pre>{JSON.stringify(message.json, null, 2)}</pre>
          </details>
        </div>
      ))}
    </div>
  );
}
