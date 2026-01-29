"use client";

import { useEffect, useMemo, useState } from "react";
import Timeline, { type TimelineMessage } from "../components/Timeline";
import IssuesPanel from "../components/IssuesPanel";
import FinalProofPanel from "../components/FinalProofPanel";
import type { Issue, Fix } from "../lib/sessions/store";

const defaultTheorem = "证明：任意连续函数在闭区间上取得最大值与最小值。";
const defaultAssumptions = "- f 在 [a,b] 上连续\n- [a,b] 为闭区间";
const defaultDraft = "";
const ROLE_SEQUENCE = [
  "Prover",
  "Skeptic",
  "CounterexampleHunter",
  "AssumptionAuditor",
  "Fixer",
  "NotationGuardian",
  "Editor",
  "Formalizer"
];

export default function HomePage() {
  const [theorem, setTheorem] = useState(defaultTheorem);
  const [assumptions, setAssumptions] = useState(defaultAssumptions);
  const [draftProof, setDraftProof] = useState(defaultDraft);
  const [model, setModel] = useState("deepseek-chat");
  const [maxRounds, setMaxRounds] = useState(1);
  const [maxRetries, setMaxRetries] = useState(2);
  const [temperature, setTemperature] = useState(0.2);
  const [thinkingMode, setThinkingMode] = useState(false);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TimelineMessage[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [fixes, setFixes] = useState<Fix[]>([]);
  const [finalProof, setFinalProof] = useState("");
  const [depsTable, setDepsTable] = useState<Array<Record<string, unknown>>>([]);
  const [status, setStatus] = useState("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);

  const fixesByIssue = useMemo(() => {
    const map = new Map<string, Fix>();
    for (const fix of fixes) {
      map.set(fix.issueId, fix);
    }
    return map;
  }, [fixes]);

  const progress = useMemo(() => {
    const seen = new Set(messages.map((message) => message.role));
    const completed = ROLE_SEQUENCE.filter((role) => seen.has(role));
    const nextRole = ROLE_SEQUENCE.find((role) => !seen.has(role)) ?? null;
    return {
      completed,
      nextRole
    };
  }, [messages]);

  useEffect(() => {
    if (!sessionId) return;

    const source = new EventSource(`/api/stream?sessionId=${sessionId}`);

    source.addEventListener("message", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as TimelineMessage;
      setMessages((prev) => [...prev, payload]);
      if (payload.role === "Editor" && typeof payload.json.finalProof === "string") {
        setFinalProof(payload.json.finalProof as string);
      }
      if (payload.role === "Formalizer" && Array.isArray(payload.json.depsTable)) {
        setDepsTable(payload.json.depsTable as Array<Record<string, unknown>>);
      }
      if (payload.role === "Fixer" && Array.isArray(payload.json.fixes)) {
        setFixes(payload.json.fixes as Fix[]);
      }
    });

    source.addEventListener("issue", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as Issue;
      setIssues((prev) => {
        const existing = prev.find((item) => item.id === payload.id);
        if (existing) {
          return prev.map((item) => (item.id === payload.id ? payload : item));
        }
        return [...prev, payload];
      });
    });

    source.addEventListener("done", (event) => {
      const payload = JSON.parse((event as MessageEvent).data);
      setStatus(payload.status ?? "done");
      if (payload.finalProof) {
        setFinalProof(payload.finalProof);
      }
      source.close();
    });

    source.addEventListener("error", (event) => {
      const payload = JSON.parse((event as MessageEvent).data ?? "{}");
      setErrorMessage(payload.message ?? "Stream error");
      setStatus("error");
      source.close();
    });

    return () => {
      source.close();
    };
  }, [sessionId]);

  const handleRun = async () => {
    setStatus("running");
    setMessages([]);
    setIssues([]);
    setFixes([]);
    setFinalProof("");
    setDepsTable([]);
    setErrorMessage(null);
    setSelectedIssueId(null);

    const response = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        theorem,
        assumptions,
        draftProof,
        config: { model, temperature, maxRounds, maxRetries, thinkingMode }
      })
    });
    const data = await response.json();
    setSessionId(data.sessionId);
  };

  return (
    <main>
      <h1>多身份 AI 互审数学证明</h1>
      <p className="muted">串行多代理 + 深度推理，自动修补证明并输出依赖表。</p>
      <div className="container">
        <section className="card">
          <h2>输入</h2>
          <div className="field">
            <label htmlFor="theorem">Theorem</label>
            <textarea
              id="theorem"
              value={theorem}
              onChange={(event) => setTheorem(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="assumptions">Assumptions</label>
            <textarea
              id="assumptions"
              value={assumptions}
              onChange={(event) => setAssumptions(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="draft">Draft Proof</label>
            <textarea
              id="draft"
              value={draftProof}
              onChange={(event) => setDraftProof(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="model">Model</label>
            <select id="model" value={model} onChange={(event) => setModel(event.target.value)}>
              <option value="deepseek-chat">deepseek-chat</option>
              <option value="deepseek-reasoner">deepseek-reasoner</option>
            </select>
          </div>
          <div className="field">
            <label>高级选项</label>
            <div className="meta-row">
              <div>
                <label htmlFor="rounds">maxRounds</label>
                <input
                  id="rounds"
                  type="number"
                  min={1}
                  value={maxRounds}
                  onChange={(event) => setMaxRounds(Number(event.target.value))}
                />
              </div>
              <div>
                <label htmlFor="retries">maxRetries</label>
                <input
                  id="retries"
                  type="number"
                  min={1}
                  value={maxRetries}
                  onChange={(event) => setMaxRetries(Number(event.target.value))}
                />
              </div>
              <div>
                <label htmlFor="temperature">temperature</label>
                <input
                  id="temperature"
                  type="number"
                  min={0}
                  max={1}
                  step={0.1}
                  value={temperature}
                  onChange={(event) => setTemperature(Number(event.target.value))}
                />
              </div>
              <div>
                <label htmlFor="thinking">thinkingMode</label>
                <select
                  id="thinking"
                  value={thinkingMode ? "on" : "off"}
                  onChange={(event) => setThinkingMode(event.target.value === "on")}
                >
                  <option value="off">off</option>
                  <option value="on">on</option>
                </select>
              </div>
            </div>
          </div>
          <button type="button" onClick={handleRun} disabled={status === "running"}>
            {status === "running" ? "Running..." : "Run"}
          </button>
          {errorMessage && <p className="muted">{errorMessage}</p>}
        </section>

        <section style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div className="card">
            <h2>Progress</h2>
            <p className="muted">状态：{status}</p>
            <ol className="progress-list">
              {ROLE_SEQUENCE.map((role) => {
                const isDone = progress.completed.includes(role);
                const isActive = status === "running" && progress.nextRole === role;
                const stateLabel = isDone ? "done" : isActive ? "running" : "pending";
                return (
                  <li key={role} className={`progress-item ${stateLabel}`}>
                    <span className="progress-role">{role}</span>
                    <span className="progress-state">{stateLabel}</span>
                  </li>
                );
              })}
            </ol>
          </div>
          <Timeline messages={messages} />
          <IssuesPanel
            issues={issues}
            selectedIssueId={selectedIssueId}
            onSelect={setSelectedIssueId}
          />
          {selectedIssueId && fixesByIssue.has(selectedIssueId) && (
            <div className="card">
              <h3>Fixer 响应</h3>
              <pre>{JSON.stringify(fixesByIssue.get(selectedIssueId), null, 2)}</pre>
            </div>
          )}
          <FinalProofPanel finalProof={finalProof} depsTable={depsTable} />
        </section>
      </div>
    </main>
  );
}
