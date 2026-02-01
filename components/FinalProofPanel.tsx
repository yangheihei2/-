"use client";

import { useMemo, useState } from "react";
import katex from "katex";

export default function FinalProofPanel({
  finalProof,
  finalProofLatex,
  depsTable,
  highlight
}: {
  finalProof: string;
  finalProofLatex?: string;
  depsTable: Array<Record<string, unknown>>;
  highlight?: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState<"proof" | "latex" | "latexSource">("proof");

  const handleCopy = async () => {
    await navigator.clipboard.writeText(finalProof || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const renderedLatex = useMemo(() => {
    if (!finalProofLatex) return "";
    return katex.renderToString(finalProofLatex, {
      displayMode: true,
      throwOnError: false
    });
  }, [finalProofLatex]);

  return (
    <div className="card">
      <div className="cardHeader">
        <div className="cardTitleRow">
          <h2>Final Proof</h2>
          <div className="hint">
            Polished proof after multi-agent review and repair.
          </div>
        </div>
        {highlight ? (
          <span className="badge">Focused: {highlight}</span>
        ) : (
          <span className="badge">Result</span>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <button
          className="btnSmall"
          onClick={handleCopy}
          disabled={!finalProof}
        >
          {copied ? "Copied" : "Copy proof"}
        </button>
        <button
          className={`btnSmall ${view === "proof" ? "active" : ""}`}
          onClick={() => setView("proof")}
        >
          Proof
        </button>
        <button
          className={`btnSmall ${view === "latex" ? "active" : ""}`}
          onClick={() => setView("latex")}
          disabled={!finalProofLatex}
        >
          LaTeX (rendered)
        </button>
        <button
          className={`btnSmall ${view === "latexSource" ? "active" : ""}`}
          onClick={() => setView("latexSource")}
          disabled={!finalProofLatex}
        >
          LaTeX source
        </button>
      </div>

      {view === "proof" && (
        <pre className="proof-pre">
          {finalProof || "Final proof has not been generated yet."}
        </pre>
      )}

      {view === "latex" && (
        <div className="proof-pre">
          {finalProofLatex ? (
            <div dangerouslySetInnerHTML={{ __html: renderedLatex }} />
          ) : (
            "LaTeX output has not been generated yet."
          )}
        </div>
      )}

      {view === "latexSource" && (
        <pre className="proof-pre">
          {finalProofLatex || "LaTeX output has not been generated yet."}
        </pre>
      )}

      <details style={{ marginTop: 14 }}>
        <summary className="muted">
          Dependency Table (click to expand)
        </summary>

        {depsTable.length === 0 ? (
          <p className="muted" style={{ marginTop: 8 }}>
            No dependency information available.
          </p>
        ) : (
          <table className="table" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Step</th>
                <th>Depends on assumptions</th>
                <th>Depends on lemmas</th>
                <th>Depends on steps</th>
              </tr>
            </thead>
            <tbody>
              {depsTable.map((row, i) => (
                <tr key={i}>
                  <td>{String(row.step ?? "")}</td>
                  <td>
                    {Array.isArray(row.dependsOnAssumptions)
                      ? row.dependsOnAssumptions.join(", ")
                      : ""}
                  </td>
                  <td>
                    {Array.isArray(row.dependsOnLemmas)
                      ? row.dependsOnLemmas.join(", ")
                      : ""}
                  </td>
                  <td>
                    {Array.isArray(row.dependsOnSteps)
                      ? row.dependsOnSteps.join(", ")
                      : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </details>
    </div>
  );
}
