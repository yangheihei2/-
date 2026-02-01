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
    const normalizedLatex = finalProofLatex.replace(/(Step\s+\d+:)/g, "\n$1").trim();
    const escapeHtml = (value: string) =>
      value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    const renderText = (value: string) => {
      let text = escapeHtml(value);
      text = text.replace(/\\textbf\{([^}]*)\}/g, "<strong>$1</strong>");
      text = text.replace(/\\textit\{([^}]*)\}/g, "<em>$1</em>");
      text = text.replace(/\\\\/g, "<br />");
      text = text.replace(/\r?\n/g, "<br />");
      return text;
    };

    const renderMath = (value: string, displayMode: boolean) =>
      katex.renderToString(value, { displayMode, throwOnError: false });

    const regex = /\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g;
    let html = "";
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(normalizedLatex)) !== null) {
      const [fullMatch, displayMath, inlineMath] = match;
      html += renderText(normalizedLatex.slice(lastIndex, match.index));
      if (displayMath) {
        html += renderMath(displayMath, true);
      } else if (inlineMath) {
        html += renderMath(inlineMath, false);
      }
      lastIndex = match.index + fullMatch.length;
    }
    html += renderText(normalizedLatex.slice(lastIndex));
    return html;
  }, [finalProofLatex]);

  const displayDepsTable = useMemo(() => {
    const normalizeArray = (value: unknown) =>
      Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];

    return depsTable
      .map((row) => {
        const record = row ?? {};
        const step = String(
          (record as any).step ??
            (record as any).stepId ??
            (record as any).stepNumber ??
            (record as any).stepName ??
            (record as any).id ??
            ""
        ).trim();
        const dependsOnAssumptions = normalizeArray((record as any).dependsOnAssumptions);
        const dependsOnLemmas = normalizeArray((record as any).dependsOnLemmas);
        const dependsOnSteps = normalizeArray((record as any).dependsOnSteps);

        return { step, dependsOnAssumptions, dependsOnLemmas, dependsOnSteps };
      })
      .filter(
        (row) =>
          row.step ||
          row.dependsOnAssumptions.length > 0 ||
          row.dependsOnLemmas.length > 0 ||
          row.dependsOnSteps.length > 0
      );
  }, [depsTable]);

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

        {displayDepsTable.length === 0 ? (
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
              {displayDepsTable.map((row, i) => (
                <tr key={i}>
                  <td>{row.step}</td>
                  <td>{row.dependsOnAssumptions.join(", ")}</td>
                  <td>{row.dependsOnLemmas.join(", ")}</td>
                  <td>{row.dependsOnSteps.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </details>
    </div>
  );
}
