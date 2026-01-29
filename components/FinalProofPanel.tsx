"use client";

import { useState } from "react";

export default function FinalProofPanel({
  finalProof,
  depsTable
}: {
  finalProof: string;
  depsTable: Array<Record<string, unknown>>;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(finalProof || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="card">
      <h2>Final Proof</h2>
      <button type="button" onClick={handleCopy} disabled={!finalProof}>
        {copied ? "Copied" : "Copy"}
      </button>
      <pre>{finalProof || "等待生成最终证明..."}</pre>
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
