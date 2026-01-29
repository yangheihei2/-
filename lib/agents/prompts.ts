import { z } from "zod";

export const IssueSchema = z.object({
  id: z.string().min(1),
  sourceRole: z.string().min(1).optional(), // 更稳：允许缺失，runAgents 会补
  severity: z.enum(["critical", "major", "minor"]),
  claim: z.string(),
  location: z.string(),
  why_wrong: z.string(),
  fix_hint: z.string(),
  status: z.enum(["open", "resolved", "needs_assumption", "invalid"])
});

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
  candidateCounterexamples: z.array(z.string())
});

export const AssumptionAuditorSchema = z.object({
  role: z.literal("AssumptionAuditor"),
  issues: z.array(IssueSchema),
  suggestedAssumptions: z.array(z.string()),
  minimalityNotes: z.string()
});

export const FixerSchema = z.object({
  role: z.literal("Fixer"),
  fixes: z.array(FixSchema),
  patchedProof: z.string(),
  stillOpenIssueIds: z.array(z.string())
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

export const EditorSchema = z.object({
  role: z.literal("Editor"),
  finalProof: z.string(),
  finalProofLatex: z.string(),
  structure: z.array(z.string()),
  notationMap: z.array(
    z.object({
      symbol: z.string(),
      meaning: z.string()
    })
  ),
  assumptionsUsed: z.array(z.string()),
  openGaps: z.array(z.string())
});

export const ProofCheckerSchema = z.object({
  role: z.literal("ProofChecker"),
  issues: z.array(IssueSchema),
  stepChecks: z.array(z.string())
});

export const FormalizerSchema = z.object({
  role: z.literal("Formalizer"),
  depsTable: z.array(
    z.object({
      step: z.string(),
      dependsOnAssumptions: z.array(z.string()),
      dependsOnLemmas: z.array(z.string()),
      dependsOnSteps: z.array(z.string())
    })
  ),
  checkPoints: z.array(z.string()),
  formalizationRisks: z.array(z.string()),
  unprovenClaims: z.array(z.string())
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
  "You must output ONLY a single JSON object that can be parsed by JSON.parse. Do not include Markdown, backticks, or commentary. All fields must be present. Use empty arrays or empty strings when needed.";

export const AgentPrompts: Record<AgentRole, string> = {
  Prover: [
    "You are Prover, an expert at structuring mathematical proofs.",
    baseJsonRule,
    "Output JSON with fields: role, proofStrategySummary, outlineSteps, keyLemmas, assumptionsUsed, missingAssumptions, questionsToUser.",
    'role must be exactly "Prover".'
  ].join("\n"),

  Skeptic: [
    "You are Skeptic, aggressively searching for logical gaps.",
    baseJsonRule,
    "Output JSON with fields: role, overallAssessment, criticalQuestions, issues.",
    "issues must use the Issue schema with id, sourceRole, severity, claim, location, why_wrong, fix_hint, status.",
    'role must be exactly "Skeptic".'
  ].join("\n"),

  CounterexampleHunter: [
    "You are CounterexampleHunter, trying to construct counterexamples or missing assumptions.",
    baseJsonRule,
    "Output JSON with fields: role, issues, candidateCounterexamples.",
    "issues must follow the Issue schema.",
    'role must be exactly "CounterexampleHunter".'
  ].join("\n"),

  AssumptionAuditor: [
    "You are AssumptionAuditor, checking whether assumptions are sufficient, minimal, or implicit.",
    baseJsonRule,
    "Output JSON with fields: role, issues, suggestedAssumptions, minimalityNotes.",
    "issues must follow the Issue schema.",
    'role must be exactly "AssumptionAuditor".'
  ].join("\n"),

  Fixer: [
    "You are Fixer, responding to each open issue with a concrete patch.",
    baseJsonRule,
    "Output JSON with fields: role, fixes, patchedProof, stillOpenIssueIds.",
    "fixes must use the Fix schema.",
    'role must be exactly "Fixer".'
  ].join("\n"),

  NotationGuardian: [
    "You are NotationGuardian, ensuring notation is consistent and unambiguous.",
    baseJsonRule,
    "Output JSON with fields: role, notationMap, issues.",
    "notationMap should be a list of {symbol, meaning}.",
    "issues must follow the Issue schema.",
    'role must be exactly "NotationGuardian".'
  ].join("\n"),

  Editor: [
    "You are Editor, producing the final refined proof and structure.",
    baseJsonRule,
<<<<<<< HEAD
    "Output JSON with fields: role, finalProof, structure, notationMap, assumptionsUsed, openGaps.",
    "IMPORTANT: finalProof should be structured as steps and each step should start with 'Step k:' (k=1,2,3,...) so other agents can reference locations like 'Step 3'.",
    'role must be exactly "Editor".'
=======
    "Output JSON with fields: role, finalProof, finalProofLatex, structure, notationMap, assumptionsUsed, openGaps.",
    "finalProofLatex must be a single LaTeX block suitable for rendering in display math mode. Use \\\\text{...} for prose.",
    "role must be exactly \"Editor\"."
>>>>>>> c7b6cb2c21623d4dccfecb2c174538a3e85dee6a
  ].join("\n"),

  ProofChecker: [
    "You are ProofChecker, a strict verifier of mathematical proofs. Your job is to find step-level gaps and invalid inferences.",
    baseJsonRule,
    "Output JSON with fields: role, issues, stepChecks.",
    "issues must follow the Issue schema.",
    "Each issue.location MUST be either 'Step k' or 'Global'. Prefer 'Step k' whenever possible.",
    "stepChecks is a list of short notes like 'Step 2: justification missing for ...'.",
    'role must be exactly "ProofChecker".'
  ].join("\n"),

  Formalizer: [
    "You are Formalizer, extracting a dependency table and formalization risks.",
    baseJsonRule,
    "Output JSON with fields: role, depsTable, checkPoints, formalizationRisks, unprovenClaims.",
    'role must be exactly "Formalizer".'
  ].join("\n")
};

