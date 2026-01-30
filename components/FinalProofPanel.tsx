"use client";

import { useState } from "react";

export default function FinalProofPanel({
  finalProof,
  depsTable,
  highlight
}: {
  finalProof: string;
  depsTable: Array<Record<string, unknown>>;
  highlight?: string | null;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(finalProof || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

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

      <button
        className="btnSmall"
        onClick={handleCopy}
        disabled={!finalProof}
        style={{ marginBottom: 10 }}
      >
        {copied ? "Copied" : "Copy proof"}
      </button>

      <pre className="proof-pre">
        {finalProof || "Final proof has not been generated yet."}
      </pre>

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
