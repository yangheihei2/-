"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import Timeline, { type TimelineMessage } from "../components/Timeline";
import IssuesPanel from "../components/IssuesPanel";
import FinalProofPanel from "../components/FinalProofPanel";
import type { Issue, Fix } from "../lib/sessions/store";

const PROVIDER_MODELS = {
  deepseek: [
    { id: "deepseek-chat", label: "DeepSeek Chat" },
    { id: "deepseek-reasoner", label: "DeepSeek Reasoner" }
  ],
  openai: [
    { id: "gpt-4o-mini", label: "GPT-4o mini (recommended)" },
    { id: "gpt-4o", label: "GPT-4o" }
  ]
} as const;

type ProviderKey = keyof typeof PROVIDER_MODELS;

const ROLE_SEQUENCE = [
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

const defaultTheorem = "Prove that any continuous function on a closed interval attains a maximum and a minimum.";
const defaultAssumptions = "- f is continuous on [a,b]\n- [a,b] is a closed interval";
const defaultDraft = "";

export default function HomePage() {
  // input
  const [theorem, setTheorem] = useState(defaultTheorem);
  const [assumptions, setAssumptions] = useState(defaultAssumptions);
  const [draftProof, setDraftProof] = useState(defaultDraft);
  const [ocrText, setOcrText] = useState("");
  const [ocrStatus, setOcrStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [ocrError, setOcrError] = useState<string | null>(null);

  // model
  const [provider, setProvider] = useState<ProviderKey>("deepseek");
  const [model, setModel] = useState<string>(PROVIDER_MODELS.deepseek[0].id);
  const [maxRounds, setMaxRounds] = useState(1);
  const [maxRetries, setMaxRetries] = useState(2);
  const [temperature, setTemperature] = useState(0.2);
  const [thinkingMode, setThinkingMode] = useState(false);

  // run state
  const [tab, setTab] = useState<"result" | "issues" | "log">("result");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TimelineMessage[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [fixes, setFixes] = useState<Fix[]>([]);
  const [finalProof, setFinalProof] = useState("");
  const [finalProofLatex, setFinalProofLatex] = useState("");
  const [depsTable, setDepsTable] = useState<Array<Record<string, unknown>>>([]);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [paperProof, setPaperProof] = useState("");
  const [paperSources, setPaperSources] = useState<Array<{ id: string; title: string; usage: string }>>([]);
  const [paperStatus, setPaperStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [paperError, setPaperError] = useState<string | null>(null);

  // provider change => default model
  useEffect(() => {
    const first = PROVIDER_MODELS[provider][0]?.id;
    if (first) setModel(first);
  }, [provider]);

  const fixesByIssue = useMemo(() => {
    const map = new Map<string, Fix>();
    for (const fix of fixes) map.set(fix.issueId, fix);
    return map;
  }, [fixes]);

  const highlight = useMemo(() => {
    if (!selectedIssueId) return null;
    const issue = issues.find((i) => i.id === selectedIssueId);
    return issue?.location || null;
  }, [selectedIssueId, issues]);

  const progress = useMemo(() => {
    const seen = new Set(messages.map((m) => m.role));
    const completed = ROLE_SEQUENCE.filter((r) => seen.has(r));
    const nextRole = ROLE_SEQUENCE.find((r) => !seen.has(r)) ?? null;
    return { completed, nextRole };
  }, [messages]);

  // SSE
  useEffect(() => {
    if (!sessionId) return;

    const source = new EventSource(`/api/stream?sessionId=${sessionId}`);

    source.addEventListener("message", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as TimelineMessage;
      setMessages((prev) => [...prev, payload]);

      if (payload.role === "Editor" && typeof payload.json.finalProof === "string") {
        setFinalProof(payload.json.finalProof as string);
      }
      if (payload.role === "Editor" && typeof payload.json.finalProofLatex === "string") {
        setFinalProofLatex(payload.json.finalProofLatex as string);
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
        const idx = prev.findIndex((x) => x.id === payload.id);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = payload;
          return copy;
        }
        return [...prev, payload];
      });
    });

    source.addEventListener("done", (event) => {
      const payload = JSON.parse((event as MessageEvent).data);
      setStatus((payload.status as any) ?? "done");
      if (payload.finalProof) setFinalProof(payload.finalProof);
      if (payload.paperProof) setPaperProof(payload.paperProof);
      if (Array.isArray(payload.paperSources)) setPaperSources(payload.paperSources);
      if (Array.isArray(payload.depsTable)) {
        setDepsTable(payload.depsTable as Array<Record<string, unknown>>);
      }
      source.close();
    });

    source.addEventListener("paper-proof", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as {
        status: "idle" | "running" | "done" | "error";
        proof?: string;
        usedPapers?: Array<{ id: string; title: string; usage: string }>;
        error?: string;
      };
      setPaperStatus(payload.status);
      if (payload.proof) setPaperProof(payload.proof);
      if (Array.isArray(payload.usedPapers)) setPaperSources(payload.usedPapers);
      if (payload.error) setPaperError(payload.error);
    });

    source.addEventListener("error", (event) => {
      if (status === "done" || status === "error") return;
      let message = "Stream error";
      try {
        const data = (event as MessageEvent).data;
        if (data) {
          const payload = JSON.parse(data);
          if (payload?.message) message = payload.message;
        }
      } catch (error) {
        message = "Stream error";
      }
      setErrorMessage(message);
      setStatus("error");
      source.close();
    });

    return () => source.close();
  }, [sessionId]);

  const handleRun = async () => {
    setStatus("running");
    setTab("result");
      setMessages([]);
      setIssues([]);
      setFixes([]);
      setFinalProof("");
      setFinalProofLatex("");
      setDepsTable([]);
      setPaperProof("");
      setPaperSources([]);
      setPaperStatus("running");
      setPaperError(null);
      setErrorMessage(null);
      setSelectedIssueId(null);

    const res = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        theorem,
        assumptions,
        draftProof,
        imageText: ocrText,
        config: { provider, model, temperature, maxRounds, maxRetries, thinkingMode }
      })
    });

    const data = await res.json();
    setSessionId(data.sessionId);
  };

  const handleImageUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setOcrStatus("running");
    setOcrError(null);

    try {
      const tesseract = (window as Window & { Tesseract?: { recognize: (input: File, lang: string) => Promise<{ data: { text?: string } }> } })
        .Tesseract;
      if (!tesseract) {
        throw new Error("OCR engine not loaded yet. Please retry in a moment.");
      }
      const { data } = await tesseract.recognize(file, "eng");
      const text = data.text?.trim() ?? "";
      setOcrText(text);
      if (text) {
        setDraftProof((prev) => (prev ? `${prev}\n\n[OCR Extract]\n${text}` : text));
      }
      setOcrStatus("done");
    } catch (error) {
      setOcrStatus("error");
      setOcrError((error as Error).message);
    }
  };

  const handleReset = () => {
    setTheorem(defaultTheorem);
    setAssumptions(defaultAssumptions);
    setDraftProof(defaultDraft);
    setOcrText("");
    setOcrStatus("idle");
    setOcrError(null);
    setTab("result");
    setMessages([]);
    setIssues([]);
    setFixes([]);
    setFinalProof("");
    setFinalProofLatex("");
    setDepsTable([]);
    setErrorMessage(null);
    setSelectedIssueId(null);
    setSessionId(null);
    setStatus("idle");
    setPaperProof("");
    setPaperSources([]);
    setPaperError(null);
    setPaperStatus("idle");
  };

  return (
    <main>
      {/* Top header */}
      <div className="toolbar">
        <div className="brand">
          <h1>Multi-Agent AI Proof Review</h1>
          <div className="sub">Switch DeepSeek / GPT, run a sequential review workflow, repair the proof, and emit a dependency table.</div>
        </div>

        <div className="toolbarRight">
          <span className={`pill ${status}`}>
            <span className="dot" />
            {status}
          </span>
          <span className="badge">Provider: {provider}</span>
          <span className="badge">Model: {model}</span>

          <button className="btnSmall" onClick={handleRun} disabled={status === "running"}>
            {status === "running" ? "Running…" : "Run"}
          </button>

          <button className="btnGhost btnSmall" onClick={handleReset} disabled={status === "running"}>
            Reset
          </button>
        </div>
      </div>

      <div className="grid">
        {/* Left: Workspace */}
        <section className="card">
          <div className="cardHeader">
            <div className="cardTitleRow">
              <h2>Workspace</h2>
              <div className="hint">Provide theorem, assumptions, and background notes (optional).</div>
            </div>
            <span className="badge">SSE live updates</span>
          </div>

          <div className="field">
            <label htmlFor="theorem">Theorem</label>
            <textarea id="theorem" value={theorem} onChange={(e) => setTheorem(e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="assumptions">Assumptions</label>
            <textarea id="assumptions" value={assumptions} onChange={(e) => setAssumptions(e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="draft">Background context (optional)</label>
            <textarea
              id="draft"
              value={draftProof}
              onChange={(e) => setDraftProof(e.target.value)}
              placeholder="Add related background, intuition, or literature notes to guide the proof search."
            />
          </div>

          <div className="field">
            <label htmlFor="background-image">Background image (OCR)</label>
            <input id="background-image" type="file" accept="image/*" onChange={handleImageUpload} />
            <div className="hint">
              OCR status: {ocrStatus}
              {ocrError ? ` · ${ocrError}` : ""}
            </div>
            {ocrText ? <pre className="proof-pre">{ocrText}</pre> : null}
          </div>

          <div className="field">
            <label>Model</label>
            <div className="metaRow">
              <div>
                <label htmlFor="provider">provider</label>
                <select id="provider" value={provider} onChange={(e) => setProvider(e.target.value as ProviderKey)}>
                  <option value="deepseek">DeepSeek</option>
                  <option value="openai">OpenAI (GPT)</option>
                </select>
              </div>

              <div>
                <label htmlFor="model">model</label>
                <select id="model" value={model} onChange={(e) => setModel(e.target.value)}>
                  {PROVIDER_MODELS[provider].map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} ({m.id})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <details className="field">
            <summary className="muted" style={{ cursor: "pointer" }}>Advanced options</summary>
            <div className="metaRow" style={{ marginTop: 10 }}>
              <div>
                <label htmlFor="rounds">maxRounds</label>
                <input id="rounds" type="number" min={1} value={maxRounds} onChange={(e) => setMaxRounds(Number(e.target.value))} />
              </div>
              <div>
                <label htmlFor="retries">maxRetries</label>
                <input id="retries" type="number" min={0} value={maxRetries} onChange={(e) => setMaxRetries(Number(e.target.value))} />
              </div>
              <div>
                <label htmlFor="temp">temperature</label>
                <input id="temp" type="number" min={0} max={1} step={0.1} value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} />
              </div>
              <div>
                <label htmlFor="thinking">thinkingMode</label>
                <select id="thinking" value={thinkingMode ? "on" : "off"} onChange={(e) => setThinkingMode(e.target.value === "on")}>
                  <option value="off">off</option>
                  <option value="on">on</option>
                </select>
              </div>
            </div>
          </details>
        </section>

        {/* Right: Progress + Tabs */}
        <section style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div className="card">
            <div className="cardHeader">
              <div className="cardTitleRow">
                <h2>Progress</h2>
                <div className="hint">Sequence: {ROLE_SEQUENCE.join(" → ")}</div>
              </div>
              <span className="badge">Session: {sessionId ? sessionId.slice(0, 8) + "…" : "—"}</span>
            </div>

            <ol className="progressList">
              {ROLE_SEQUENCE.map((role) => {
                const isDone = progress.completed.includes(role);
                const isActive = status === "running" && progress.nextRole === role;
                const stateLabel = isDone ? "done" : isActive ? "running" : "pending";
                return (
                  <li key={role} className={`progressItem ${stateLabel}`}>
                    <span className="progressRole">{role}</span>
                    <span className="progressState">{stateLabel}</span>
                  </li>
                );
              })}
            </ol>
          </div>

          <div className="card">
            <div className="cardHeader">
              <div className="cardTitleRow">
                <h2>Error</h2>
                <div className="hint">If API keys are missing or outputs violate schema, errors will appear here.</div>
              </div>
              {highlight ? <span className="badge">Focused: {highlight}</span> : <span className="badge">—</span>}
            </div>

            {status !== "error" && !errorMessage ? (
              <p className="muted">No errors yet.</p>
            ) : (
              <div className="error-panel">
                <p className="error-title">Run failed</p>
                <pre className="proof-pre">{errorMessage || "Unknown error"}</pre>
              </div>
            )}
          </div>

          {/* Tabs */}
          <div className="card">
            <div className="tabbar">
              <button className={`tab ${tab === "result" ? "active" : ""}`} onClick={() => setTab("result")}>
                Result
              </button>
              <button className={`tab ${tab === "issues" ? "active" : ""}`} onClick={() => setTab("issues")}>
                Issues {issues.length ? `(${issues.length})` : ""}
              </button>
              <button className={`tab ${tab === "log" ? "active" : ""}`} onClick={() => setTab("log")}>
                Run Log {messages.length ? `(${messages.length})` : ""}
              </button>
            </div>
            <p className="muted" style={{ marginTop: 8 }}>
              Default view shows the final result only. Details are available on demand.
            </p>
          </div>

          {tab === "result" && (
            <>
              <FinalProofPanel
                finalProof={finalProof}
                finalProofLatex={finalProofLatex}
                depsTable={depsTable}
                highlight={highlight}
              />
              <div className="card">
                <div className="cardHeader">
                  <div className="cardTitleRow">
                    <h2>Paper-based Proof</h2>
                    <div className="hint">
                      Generated during Run by retrieving proof excerpts from the paper library.
                    </div>
                  </div>
                  <span className="badge">
                    {paperStatus === "running"
                      ? "Searching…"
                      : paperSources.length
                      ? `${paperSources.length} papers used`
                      : "—"}
                  </span>
                </div>
                {paperError ? (
                  <div className="error-panel">
                    <p className="error-title">Paper proof failed</p>
                    <pre className="proof-pre">{paperError}</pre>
                  </div>
                ) : paperStatus === "running" ? (
                  <p className="muted">Searching paper library and composing proof…</p>
                ) : paperProof ? (
                  <>
                    {paperSources.length ? (
                      <div style={{ marginBottom: 12 }}>
                        <strong>Sources</strong>
                        <ul className="muted">
                          {paperSources.map((paper) => (
                            <li key={paper.id}>
                              <strong>{paper.title}</strong>: {paper.usage}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    <pre className="proof-pre">{paperProof}</pre>
                  </>
                ) : (
                  <p className="muted">Run the workflow to generate a paper-based proof.</p>
                )}
              </div>
            </>
          )}

          {tab === "issues" && (
            <>
              <IssuesPanel issues={issues} selectedIssueId={selectedIssueId} onSelect={setSelectedIssueId} />
              {selectedIssueId && fixesByIssue.has(selectedIssueId) && (
                <div className="card">
                  <h2>Fixer Response</h2>
                  <pre className="proof-pre">{JSON.stringify(fixesByIssue.get(selectedIssueId), null, 2)}</pre>
                </div>
              )}
            </>
          )}

          {tab === "log" && <Timeline messages={messages} compact />}
        </section>
      </div>
    </main>
  );
}
