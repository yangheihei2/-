"use client";

import { useMemo, useState } from "react";
import katex from "katex";

export default function FinalProofPanel({
  finalProof,
  finalProofLatex,
  depsTable
}: {
  finalProof: string;
  finalProofLatex: string;
  depsTable: Array<Record<string, unknown>>;
}) {
  const [copied, setCopied] = useState(false);
  const [copiedLatex, setCopiedLatex] = useState(false);

  const renderedLatex = useMemo(() => {
    if (!finalProofLatex) return "";
    try {
      return katex.renderToString(finalProofLatex, {
        displayMode: true,
        throwOnError: false
      });
    } catch (error) {
      return "";
    }
  }, [finalProofLatex]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(finalProof || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleCopyLatex = async () => {
    await navigator.clipboard.writeText(finalProofLatex || "");
    setCopiedLatex(true);
    setTimeout(() => setCopiedLatex(false), 1500);
  };

  return (
    <div className="card">
      <h2>Final Proof</h2>
      <div className="button-row">
        <button type="button" onClick={handleCopy} disabled={!finalProof}>
          {copied ? "Copied" : "Copy Text"}
        </button>
        <button type="button" onClick={handleCopyLatex} disabled={!finalProofLatex}>
          {copiedLatex ? "Copied" : "Copy LaTeX"}
        </button>
      </div>
      {renderedLatex ? (
        <div
          className="latex-output"
          dangerouslySetInnerHTML={{ __html: renderedLatex }}
        />
      ) : (
        <pre>{finalProof || "等待生成最终证明..."}</pre>
      )}
      <h3>depsTable</h3>
      {depsTable.length === 0 ? (
        <p className="muted">暂无依赖表。</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>step</th>
              <th>dependsOnAssumptions</th>
              <th>dependsOnLemmas</th>
              <th>dependsOnSteps</th>
            </tr>
          </thead>
          <tbody>
            {depsTable.map((row, index) => (
              <tr key={`row-${index}`}>
                <td>{String(row.step ?? "")}</td>
                <td>{Array.isArray(row.dependsOnAssumptions) ? row.dependsOnAssumptions.join(", ") : ""}</td>
                <td>{Array.isArray(row.dependsOnLemmas) ? row.dependsOnLemmas.join(", ") : ""}</td>
                <td>{Array.isArray(row.dependsOnSteps) ? row.dependsOnSteps.join(", ") : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
