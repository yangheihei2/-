import { z } from "zod";

/** Map model severities to strict enum */
const SeveritySchema = z
  .enum(["critical", "major", "minor", "high", "medium", "low"])
  .transform((s) => {
    if (s === "high") return "critical" as const;
    if (s === "medium") return "major" as const;
    if (s === "low") return "minor" as const;
    return s;
  });

  export const IssueSchema = z.preprocess((val) => {
    const obj = (val ?? {}) as any;
  
    // normalize severity if present
    const sev = String(obj.severity ?? "").toLowerCase();
    const severity =
      sev === "high" ? "critical"
      : sev === "medium" ? "major"
      : sev === "low" ? "minor"
      : (obj.severity ?? "major");
  
    return {
      id: obj.id ?? "unknown_issue",
      sourceRole: obj.sourceRole ?? "Unknown",
      severity,
      claim: obj.claim ?? obj.problem ?? obj.issue ?? "",
      location: obj.location ?? "Global",
      why_wrong: obj.why_wrong ?? obj.whyWrong ?? obj.rationale ?? "",
      fix_hint: obj.fix_hint ?? obj.fixHint ?? obj.suggestion ?? "",
      status: obj.status ?? "open"
    };
  }, z.object({
    id: z.string().min(1),
    sourceRole: z.string().min(1),
    severity: z.enum(["critical", "major", "minor"]),
    claim: z.string(),        // now guaranteed to exist (maybe empty)
    location: z.string(),
    why_wrong: z.string(),
    fix_hint: z.string(),
    status: z.enum(["open", "resolved", "needs_assumption", "invalid"])
  }));
  

export const FixSchema = z.object({
  issueId: z.string().min(1),
  response: z.string(),
  status: z.enum(["resolved", "needs_assumption", "cannot_fix"]),
  patchSummary: z.string()
});

export const ProverSchema = z.object({
  role: z.literal("Prover"),
  proofStrategySummary: z.string(),
  outlineSteps: z.array(z.string()),
  keyLemmas: z.array(z.string()),
  assumptionsUsed: z.array(z.string()),
  missingAssumptions: z.array(z.string()),
  questionsToUser: z.array(z.string())
});

export const SkepticSchema = z.object({
  role: z.literal("Skeptic"),
  overallAssessment: z.string(),
  criticalQuestions: z.array(z.string()),
  issues: z.array(IssueSchema)
});

export const CounterexampleSchema = z.object({
  role: z.literal("CounterexampleHunter"),
  issues: z.array(IssueSchema),
  candidateCounterexamples: z.preprocess(
    (v) => (Array.isArray(v) ? v.map((item) => String(item)) : []),
    z.array(z.string())
  )
});

export const NotationGuardianSchema = z.object({
  role: z.literal("NotationGuardian"),
  notationMap: z.array(
    z.object({
      symbol: z.string(),
      meaning: z.string()
    })
  ),
  issues: z.array(IssueSchema)
});

const StringArray = z.preprocess((v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return [];
    // split by newlines or bullets
    return s
      .split(/\r?\n|•|- |\* /)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return [];
}, z.array(z.string()));

const NotationArray = z.preprocess((v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    // if model returned a string, we can’t reliably parse pairs; return empty list
    return [];
  }
  return [];
}, z.array(z.object({ symbol: z.string(), meaning: z.string() })));

export const AssumptionAuditorSchema = z.object({
  role: z.literal("AssumptionAuditor"),
  issues: z.array(IssueSchema),
  suggestedAssumptions: StringArray,
  minimalityNotes: z.string()
});

export const FixerSchema = z.object({
  role: z.literal("Fixer"),
  fixes: z.array(FixSchema),
  patchedProof: z.string(),
  stillOpenIssueIds: z.array(z.string())
});

export const EditorSchema = z.object({
  role: z.literal("Editor"),
  finalProof: z.string(),
  finalProofLatex: z.string().optional(),
  structure: StringArray,          // ✅ tolerate string -> array
  notationMap: NotationArray,      // ✅ tolerate string -> []
  assumptionsUsed: StringArray,    // ✅ also tolerate string
  openGaps: StringArray            // ✅ also tolerate string
});


export const ProofCheckerSchema = z.object({
  role: z.literal("ProofChecker"),
  issues: z.array(IssueSchema),
  stepChecks: z.array(z.string())
});

const DepsTableRowSchema = z.preprocess((val) => {
  const normalizeStringArray = (value: unknown) => {
    if (Array.isArray(value)) return value.map((item) => String(item)).filter((item) => item.trim());
    if (typeof value === "string") {
      return value
        .split(/[,;\n]+/)
        .map((item) => item.trim())
        .filter(Boolean);
    }
    if (value === null || value === undefined) return [];
    return [String(value)].filter((item) => item.trim());
  };

  if (typeof val === "string") {
    return {
      step: val,
      dependsOnAssumptions: [],
      dependsOnLemmas: [],
      dependsOnSteps: []
    };
  }

  const obj = (val ?? {}) as Record<string, unknown>;
  const stepValue =
    obj.step ??
    obj.stepId ??
    obj.stepNumber ??
    obj.stepName ??
    obj.id ??
    obj.label ??
    "";
  const assumptionsValue =
    obj.dependsOnAssumptions ??
    obj.depends_on_assumptions ??
    obj.assumptions ??
    obj.assumptionDeps ??
    obj.assumptionDependencies ??
    obj.dependsOnAssumption ??
    (obj.dependsOn as any)?.assumptions;
  const lemmasValue =
    obj.dependsOnLemmas ??
    obj.depends_on_lemmas ??
    obj.lemmas ??
    obj.lemmaDeps ??
    obj.lemmaDependencies ??
    obj.dependsOnLemma ??
    (obj.dependsOn as any)?.lemmas;
  const stepsValue =
    obj.dependsOnSteps ??
    obj.depends_on_steps ??
    obj.steps ??
    obj.stepDeps ??
    obj.stepDependencies ??
    obj.dependsOnStep ??
    (obj.dependsOn as any)?.steps;

  return {
    step: stepValue ? String(stepValue) : "",
    dependsOnAssumptions: normalizeStringArray(assumptionsValue),
    dependsOnLemmas: normalizeStringArray(lemmasValue),
    dependsOnSteps: normalizeStringArray(stepsValue)
  };
}, z.object({
  step: z.string(),
  dependsOnAssumptions: z.array(z.string()),
  dependsOnLemmas: z.array(z.string()),
  dependsOnSteps: z.array(z.string())
}));

export const FormalizerSchema = z.object({
  role: z.literal("Formalizer"),
  depsTable: z.preprocess(
    (v) => (Array.isArray(v) ? v : []),
    z.array(DepsTableRowSchema)
  ),
  checkPoints: z.preprocess(
    (v) => (Array.isArray(v) ? v.map((item) => String(item)) : []),
    z.array(z.string())
  ),
  formalizationRisks: z.preprocess(
    (v) => (Array.isArray(v) ? v.map((item) => String(item)) : []),
    z.array(z.string())
  ),
  unprovenClaims: z.preprocess(
    (v) => (Array.isArray(v) ? v.map((item) => String(item)) : []),
    z.array(z.string())
  )
});

export const AgentSchemas = {
  Prover: ProverSchema,
  Skeptic: SkepticSchema,
  CounterexampleHunter: CounterexampleSchema,
  AssumptionAuditor: AssumptionAuditorSchema,
  Fixer: FixerSchema,
  NotationGuardian: NotationGuardianSchema,
  Editor: EditorSchema,
  ProofChecker: ProofCheckerSchema,
  Formalizer: FormalizerSchema
} as const;

export type AgentRole = keyof typeof AgentSchemas;

const baseJsonRule =
  "Output ONLY one JSON object parseable by JSON.parse. No markdown, no backticks, no extra text. All fields must be present. Use empty arrays/strings when needed.";

const issueRule = [
  "For issues:",
  "- severity MUST be one of: critical, major, minor (avoid high/medium/low if possible).",
  "- sourceRole MUST be your role name exactly.",
  "- location MUST be either 'Global' or 'Step k' (k is an integer).",
  "- status is usually 'open' unless you are explicitly resolving it."
].join("\n");

export const AgentPrompts: Record<AgentRole, string> = {
  Prover: [
    "You are Prover, an expert at structuring mathematical proofs.",
    baseJsonRule,
    "Return JSON fields: role, proofStrategySummary, outlineSteps, keyLemmas, assumptionsUsed, missingAssumptions, questionsToUser.",
    "Keep it concise: outlineSteps max 6 items, keyLemmas max 6 items, questionsToUser max 2 items.",
    'role must be exactly "Prover".'
  ].join("\n"),

  Skeptic: [
    "You are Skeptic, aggressively searching for logical gaps.",
    baseJsonRule,
    "Return JSON fields: role, overallAssessment, criticalQuestions, issues.",
    "issues must follow the Issue schema.",
    issueRule,
    'role must be exactly "Skeptic".'
  ].join("\n"),

  CounterexampleHunter: [
    "You are CounterexampleHunter, trying to construct counterexamples or missing assumptions.",
    baseJsonRule,
    "Return JSON fields: role, issues, candidateCounterexamples.",
    "issues must follow the Issue schema.",
    issueRule,
    'role must be exactly "CounterexampleHunter".'
  ].join("\n"),

  AssumptionAuditor: [
    "You are AssumptionAuditor, checking whether assumptions are sufficient/minimal/implicit.",
    baseJsonRule,
    "Return JSON fields: role, issues, suggestedAssumptions, minimalityNotes.",
    "issues must follow the Issue schema.",
    issueRule,
    'role must be exactly "AssumptionAuditor".'
  ].join("\n"),

  Fixer: [
    "You are Fixer, patching the proof to address open issues.",
    baseJsonRule,
    "Return JSON fields: role, fixes, patchedProof, stillOpenIssueIds.",
    "fixes must follow the Fix schema.",
    'role must be exactly "Fixer".'
  ].join("\n"),

  NotationGuardian: [
    "You are NotationGuardian, ensuring notation is consistent and unambiguous.",
    baseJsonRule,
    "Return JSON fields: role, notationMap, issues.",
    "notationMap is a list of {symbol, meaning}.",
    "issues must follow the Issue schema.",
    issueRule,
    'role must be exactly "NotationGuardian".'
  ].join("\n"),

  Editor: [
    "You are Editor, producing the final polished proof.",
    baseJsonRule,
    "Return JSON fields: role, finalProof, finalProofLatex, structure, notationMap, assumptionsUsed, openGaps.",
    "IMPORTANT: finalProof MUST be step-structured; each step starts with 'Step k:' (k=1,2,3...).",
    "finalProofLatex should be a LaTeX version of the proof (string).",
    'role must be exactly "Editor".'
  ].join("\n"),

  ProofChecker: [
    "You are ProofChecker, a strict verifier of the proof. Find step-level gaps and invalid inferences.",
    baseJsonRule,
    "Return JSON fields: role, issues, stepChecks.",
    "issues must follow the Issue schema.",
    issueRule,
    "stepChecks is a list of short notes like 'Step 2: missing justification for ...'.",
    'role must be exactly "ProofChecker".'
  ].join("\n"),

  Formalizer: [
    "You are Formalizer, extracting a dependency table and formalization risks.",
    baseJsonRule,
    "Return JSON fields: role, depsTable, checkPoints, formalizationRisks, unprovenClaims.",
    'role must be exactly "Formalizer".'
  ].join("\n")
};
