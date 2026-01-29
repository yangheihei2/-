"use client";

import type { Issue } from "../lib/sessions/store";

const statusLabels: Record<Issue["status"], string> = {
  open: "open",
  resolved: "resolved",
  needs_assumption: "needs assumption",
  invalid: "invalid"
};

export default function IssuesPanel({
  issues,
  selectedIssueId,
  onSelect
}: {
  issues: Issue[];
  selectedIssueId: string | null;
  onSelect: (issueId: string) => void;
}) {
  return (
    <div className="card">
      <h2>Issues</h2>
      {issues.length === 0 && <p className="muted">暂无漏洞。</p>}
      {issues.map((issue) => (
        <div
          key={issue.id}
          className={`issue-row ${selectedIssueId === issue.id ? "active" : ""}`}
          onClick={() => onSelect(issue.id)}
        >
          <div className={`issue-tag ${issue.severity}`}>{issue.severity}</div>
          <div className="issue-tag">{statusLabels[issue.status]}</div>
          <div>
            <strong>{issue.claim}</strong>
            <div className="muted">{issue.location}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
