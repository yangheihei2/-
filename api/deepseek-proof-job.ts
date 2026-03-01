import { callDeepSeek } from './deepseek-client.js';

const defaultModel = 'deepseek-chat';
const allowedModels = new Set(['deepseek-chat', 'deepseek-reasoner']);
const JOB_BUDGET_MS_DEFAULT = 240000;
const JOB_BUDGET_MS_MIN = 60000;
const JOB_BUDGET_MS_MAX = 280000;
const STEP_TIMEOUT_MS_DEFAULT = 45000;
const STEP_TIMEOUT_MS_MIN = 15000;
const STEP_TIMEOUT_MS_MAX = 90000;

export type AttemptStatus = 'ok' | 'empty' | 'error';

export interface AttemptReport {
  model: string;
  promptType: 'full' | 'compact';
  status: AttemptStatus;
  detail: string;
}

interface PromptCandidate {
  type: 'full' | 'compact';
  content: string;
}

export interface ProofJobState {
  v: 1;
  theorem: string;
  assumptions: string;
  modelCandidates: string[];
  promptCandidates: PromptCandidate[];
  modelIndex: number;
  promptIndex: number;
  attempts: AttemptReport[];
  startedAt: number;
  deadlineAt: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getJobBudgetMs() {
  const configured = Number(process.env.DEEPSEEK_JOB_BUDGET_MS || '');
  const base = Number.isFinite(configured) ? Math.floor(configured) : JOB_BUDGET_MS_DEFAULT;
  return clamp(base, JOB_BUDGET_MS_MIN, JOB_BUDGET_MS_MAX);
}

function getStepTimeoutMs() {
  const configured = Number(process.env.DEEPSEEK_JOB_STEP_TIMEOUT_MS || '');
  const base = Number.isFinite(configured) ? Math.floor(configured) : STEP_TIMEOUT_MS_DEFAULT;
  return clamp(base, STEP_TIMEOUT_MS_MIN, STEP_TIMEOUT_MS_MAX);
}

export function buildPrompt(theorem: string, assumptions: string, compact = false) {
  const base = `You are a mathematical proof assistant.
Theorem: ${theorem}
Assumptions: ${assumptions}

Return a proof that can be directly rendered by MathJax in a web page.
Requirements:
1) Use readable sections: Theorem, Key Lemmas, Proof, and Conclusion.
2) Write normal text plus math expressions using \\(...\\) and \\[...\\].
3) Do not output full LaTeX document preamble (no \\documentclass, \\begin{document}, etc).
4) Keep the argument rigorous and concise.
5) End with \\qed or an explicit QED statement.`;

  if (!compact) {
    return base;
  }

  return `Provide a concise, rigorous proof in MathJax-friendly text only.
Theorem: ${theorem}
Assumptions: ${assumptions || '(none)'}
Use sections: Theorem, Proof, Conclusion.
No markdown code fences or full LaTeX preamble.`;
}

function extractProofContent(data: any) {
  const raw = data?.choices?.[0]?.message?.content;
  if (typeof raw !== 'string') return '';
  return raw.trim();
}

export function buildReadableSummary(attempts: AttemptReport[]) {
  if (attempts.length === 0) {
    return 'No attempt was made.';
  }

  return attempts
    .map((attempt, index) => `${index + 1}. [${attempt.model}/${attempt.promptType}] ${attempt.status.toUpperCase()}: ${attempt.detail}`)
    .join(' | ');
}

function encodeToken(state: ProofJobState) {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64url');
}

function decodeToken(token: string): ProofJobState {
  const json = Buffer.from(token, 'base64url').toString('utf8');
  const parsed = JSON.parse(json);
  if (parsed?.v !== 1) {
    throw new Error('Unsupported job token version.');
  }
  return parsed as ProofJobState;
}

function advanceState(state: ProofJobState) {
  const next = { ...state };
  const nextPrompt = next.promptIndex + 1;
  if (nextPrompt < next.promptCandidates.length) {
    next.promptIndex = nextPrompt;
    return next;
  }

  next.promptIndex = 0;
  next.modelIndex += 1;
  return next;
}

function hasRemainingAttempt(state: ProofJobState) {
  return state.modelIndex < state.modelCandidates.length;
}

export function createProofJobState(theorem: string, assumptions: string, requestedModel: string): ProofJobState {
  const model = allowedModels.has(requestedModel) ? requestedModel : defaultModel;
  const fallbackModel = model === 'deepseek-chat' ? 'deepseek-reasoner' : 'deepseek-chat';
  const modelCandidates = [model, fallbackModel].filter((candidate, idx, arr) => arr.indexOf(candidate) === idx);
  const promptCandidates: PromptCandidate[] = [
    { type: 'full', content: buildPrompt(theorem, assumptions, false) },
    { type: 'compact', content: buildPrompt(theorem, assumptions, true) },
  ];
  const startedAt = Date.now();
  return {
    v: 1,
    theorem,
    assumptions,
    modelCandidates,
    promptCandidates,
    modelIndex: 0,
    promptIndex: 0,
    attempts: [],
    startedAt,
    deadlineAt: startedAt + getJobBudgetMs(),
  };
}

export function stateToToken(state: ProofJobState) {
  return encodeToken(state);
}

export function stateFromToken(token: string) {
  return decodeToken(token);
}

export async function runProofJobStep(apiKey: string, state: ProofJobState) {
  if (Date.now() >= state.deadlineAt) {
    return {
      status: 'failed' as const,
      error: 'DeepSeek proof generation exceeded the async job budget.',
      errorCode: 'DEEPSEEK_JOB_BUDGET_EXCEEDED',
      userHint: 'The async generation budget was exhausted before completion. Retry or simplify theorem/assumptions.',
      summary: buildReadableSummary(state.attempts),
      attempts: state.attempts,
    };
  }

  if (!hasRemainingAttempt(state)) {
    return {
      status: 'failed' as const,
      error: 'DeepSeek proof generation failed after all fallback attempts.',
      errorCode: 'DEEPSEEK_GENERATION_ALL_ATTEMPTS_FAILED',
      userHint: 'All retries and model fallbacks failed. Please retry later, or switch to Gemini to validate whether the input is fine.',
      summary: buildReadableSummary(state.attempts),
      attempts: state.attempts,
    };
  }

  const candidateModel = state.modelCandidates[state.modelIndex];
  const promptCandidate = state.promptCandidates[state.promptIndex];

  try {
    const data = await callDeepSeek({
      apiKey,
      model: candidateModel,
      messages: [{ role: 'user', content: promptCandidate.content }],
      temperature: 0.2,
      timeoutMs: getStepTimeoutMs(),
      maxRetries: 0,
    });

    const proof = extractProofContent(data);
    if (proof) {
      const attempts = [
        ...state.attempts,
        {
          model: candidateModel,
          promptType: promptCandidate.type,
          status: 'ok' as const,
          detail: 'non-empty proof returned',
        },
      ];

      return {
        status: 'completed' as const,
        proof,
        modelUsed: candidateModel,
        compactPrompt: promptCandidate.type === 'compact',
        attempts,
      };
    }

    const progressed = advanceState({
      ...state,
      attempts: [
        ...state.attempts,
        {
          model: candidateModel,
          promptType: promptCandidate.type,
          status: 'empty',
          detail: 'API returned empty content',
        },
      ],
    });

    return {
      status: 'in_progress' as const,
      token: encodeToken(progressed),
      attempts: progressed.attempts,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown DeepSeek request error.';
    const progressed = advanceState({
      ...state,
      attempts: [
        ...state.attempts,
        {
          model: candidateModel,
          promptType: promptCandidate.type,
          status: 'error',
          detail: message,
        },
      ],
    });

    return {
      status: 'in_progress' as const,
      token: encodeToken(progressed),
      attempts: progressed.attempts,
    };
  }
}
