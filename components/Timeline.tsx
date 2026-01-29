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
      {sorted.length === 0 && <p className="muted">等待运行日志...</p>}
      {sorted.map((message, index) => (
        <div className="timeline-item" key={`${message.role}-${index}`}>
          <header>
            <strong>{message.role}</strong>
            <span className="badge">{new Date(message.createdAt).toLocaleTimeString()}</span>
          </header>
          <p className="muted">
            {message.metadata?.durationMs ? `耗时 ${message.metadata.durationMs}ms` : ""}
            {message.metadata?.retries ? ` · 重试 ${message.metadata.retries} 次` : ""}
          </p>
          <details>
            <summary className="muted">展开 JSON</summary>
            <pre>{JSON.stringify(message.json, null, 2)}</pre>
          </details>
        </div>
      ))}
    </div>
  );
}
