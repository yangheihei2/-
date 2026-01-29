import { z } from "zod";

export const IssueSchema = z.object({
  id: z.string().min(1),
  sourceRole: z.string().min(1),
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
  notationMap: z.array(z.object({
    symbol: z.string(),
    meaning: z.string()
  })),
  issues: z.array(IssueSchema)
});

export const EditorSchema = z.object({
  role: z.literal("Editor"),
  finalProof: z.string(),
  structure: z.array(z.string()),
  notationMap: z.array(z.object({
    symbol: z.string(),
    meaning: z.string()
  })),
  assumptionsUsed: z.array(z.string()),
  openGaps: z.array(z.string())
});

export const FormalizerSchema = z.object({
  role: z.literal("Formalizer"),
  depsTable: z.array(z.object({
    step: z.string(),
    dependsOnAssumptions: z.array(z.string()),
    dependsOnLemmas: z.array(z.string()),
    dependsOnSteps: z.array(z.string())
  })),
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
  Formalizer: FormalizerSchema
} as const;

export type AgentRole = keyof typeof AgentSchemas;

const baseJsonRule = "You must output ONLY a single JSON object that can be parsed by JSON.parse. Do not include Markdown, backticks, or commentary. All fields must be present. Use empty arrays or empty strings when needed.";

export const AgentPrompts: Record<AgentRole, string> = {
  Prover: [
    "You are Prover, an expert at structuring mathematical proofs.",
    baseJsonRule,
    "Output JSON with fields: role, proofStrategySummary, outlineSteps, keyLemmas, assumptionsUsed, missingAssumptions, questionsToUser.",
    "role must be exactly \"Prover\"."
  ].join("\n"),
  Skeptic: [
    "You are Skeptic, aggressively searching for logical gaps.",
    baseJsonRule,
    "Output JSON with fields: role, overallAssessment, criticalQuestions, issues.",
    "issues must use the Issue schema with id, sourceRole, severity, claim, location, why_wrong, fix_hint, status.",
    "role must be exactly \"Skeptic\"."
  ].join("\n"),
  CounterexampleHunter: [
    "You are CounterexampleHunter, trying to construct counterexamples or missing assumptions.",
    baseJsonRule,
    "Output JSON with fields: role, issues, candidateCounterexamples.",
    "issues must follow the Issue schema.",
    "role must be exactly \"CounterexampleHunter\"."
  ].join("\n"),
  AssumptionAuditor: [
    "You are AssumptionAuditor, checking whether assumptions are sufficient, minimal, or implicit.",
    baseJsonRule,
    "Output JSON with fields: role, issues, suggestedAssumptions, minimalityNotes.",
    "issues must follow the Issue schema.",
    "role must be exactly \"AssumptionAuditor\"."
  ].join("\n"),
  Fixer: [
    "You are Fixer, responding to each open issue with a concrete patch.",
    baseJsonRule,
    "Output JSON with fields: role, fixes, patchedProof, stillOpenIssueIds.",
    "fixes must use the Fix schema.",
    "role must be exactly \"Fixer\"."
  ].join("\n"),
  NotationGuardian: [
    "You are NotationGuardian, ensuring notation is consistent and unambiguous.",
    baseJsonRule,
    "Output JSON with fields: role, notationMap, issues.",
    "notationMap should be a list of {symbol, meaning}.",
    "issues must follow the Issue schema.",
    "role must be exactly \"NotationGuardian\"."
  ].join("\n"),
  Editor: [
    "You are Editor, producing the final refined proof and structure.",
    baseJsonRule,
    "Output JSON with fields: role, finalProof, structure, notationMap, assumptionsUsed, openGaps.",
    "role must be exactly \"Editor\"."
  ].join("\n"),
  Formalizer: [
    "You are Formalizer, extracting a dependency table and formalization risks.",
    baseJsonRule,
    "Output JSON with fields: role, depsTable, checkPoints, formalizationRisks, unprovenClaims.",
    "role must be exactly \"Formalizer\"."
  ].join("\n")
};
