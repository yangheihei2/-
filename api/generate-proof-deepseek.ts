import { callDeepSeek } from '../lib/deepseek-client.js';

const defaultModel = 'deepseek-v4-pro';
const allowedModels = new Set(['deepseek-v4-pro', 'deepseek-v4-flash']);
const fallbackModel = 'deepseek-v4-flash';

type AttemptStatus = 'ok' | 'empty' | 'error';
const PROOF_FULL_PROMPT_TIMEOUT_MS = 180000;
const PROOF_COMPACT_PROMPT_TIMEOUT_MS = 85000;

interface AttemptReport {
  model: string;
  promptType: 'full' | 'compact';
  status: AttemptStatus;
  detail: string;
}

function buildPrompt(theorem: string, assumptions: string, knowledgeReferences: unknown[], literatureBrief: string, compact = false) {
  const literatureSection = literatureBrief
    ? `\nRelated academic literature:\n${literatureBrief}\n\nLeverage relevant methods and results from these references where applicable.`
    : '';

  const base = `You are a mathematical proof assistant.
Theorem: ${theorem}
Assumptions: ${assumptions}
Knowledge-base references (weighted): ${JSON.stringify(knowledgeReferences)}
${literatureSection}

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
Knowledge-base references (weighted): ${JSON.stringify(knowledgeReferences)}
${literatureSection}
Use sections: Theorem, Proof, Conclusion.
No markdown code fences or full LaTeX preamble.`;
}

function extractProofContent(data: any) {
  const raw = data?.choices?.[0]?.message?.content;
  if (typeof raw !== 'string') return '';
  return raw.trim();
}

function buildReadableSummary(attempts: AttemptReport[]) {
  if (attempts.length === 0) {
    return 'No attempt was made.';
  }

  return attempts
    .map((attempt, index) => `${index + 1}. [${attempt.model}/${attempt.promptType}] ${attempt.status.toUpperCase()}: ${attempt.detail}`)
    .join(' | ');
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'Server env DEEPSEEK_API_KEY is not configured.',
      errorCode: 'DEEPSEEK_KEY_MISSING',
      userHint: 'Please configure DEEPSEEK_API_KEY on the server before using DeepSeek models.',
    });
  }

  const theorem = typeof req.body?.theorem === 'string' ? req.body.theorem : '';
  const assumptions = typeof req.body?.assumptions === 'string' ? req.body.assumptions : '';
  const requestedModel = typeof req.body?.model === 'string' ? req.body.model : defaultModel;
  const model = allowedModels.has(requestedModel) ? requestedModel : defaultModel;
  const knowledgeReferences = Array.isArray(req.body?.knowledgeReferences) ? req.body.knowledgeReferences : [];
  const literatureBrief = typeof req.body?.literatureBrief === 'string' ? req.body.literatureBrief : '';

  if (!theorem.trim()) {
    return res.status(400).json({ error: 'Theorem is required.' });
  }

  try {
    const promptCandidates = [
      { type: 'full' as const, content: buildPrompt(theorem, assumptions, knowledgeReferences, literatureBrief, false) },
      { type: 'compact' as const, content: buildPrompt(theorem, assumptions, knowledgeReferences, literatureBrief, true) },
    ];
    const modelCandidates = model === fallbackModel ? [model] : [model, fallbackModel];
    const attempts: AttemptReport[] = [];

    for (const candidateModel of modelCandidates) {
      for (const promptCandidate of promptCandidates) {
        try {
          const data = await callDeepSeek({
            apiKey,
            model: candidateModel,
            messages: [{ role: 'user', content: promptCandidate.content }],
            temperature: 0.2,
            requestTimeoutMs: promptCandidate.type === 'full' ? PROOF_FULL_PROMPT_TIMEOUT_MS : PROOF_COMPACT_PROMPT_TIMEOUT_MS,
            maxRetries: 0,
          });

          const proof = extractProofContent(data);
          if (proof) {
            attempts.push({
              model: candidateModel,
              promptType: promptCandidate.type,
              status: 'ok',
              detail: 'non-empty proof returned',
            });
            return res.status(200).json({
              proof,
              modelUsed: candidateModel,
              compactPrompt: promptCandidate.type === 'compact',
              attempts,
            });
          }

          attempts.push({
            model: candidateModel,
            promptType: promptCandidate.type,
            status: 'empty',
            detail: 'API returned empty content',
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown DeepSeek request error.';
          attempts.push({
            model: candidateModel,
            promptType: promptCandidate.type,
            status: 'error',
            detail: message,
          });
        }
      }
    }

    return res.status(502).json({
      error: 'DeepSeek proof generation failed after trying the selected model, compact prompts, and Flash fallback.',
      errorCode: 'DEEPSEEK_GENERATION_SELECTED_MODEL_FAILED',
      userHint: 'DeepSeek timed out or returned no content. Try Flash directly, simplify assumptions, or shorten the theorem statement.',
      summary: buildReadableSummary(attempts),
      attempts,
    });
  } catch (error) {
    console.error('DeepSeek generator error:', error);
    const message = error instanceof Error ? error.message : 'DeepSeek request failed. Please retry later.';
    return res.status(500).json({
      error: message,
      errorCode: 'DEEPSEEK_GENERATION_UNCAUGHT_ERROR',
      userHint: 'An uncaught server error occurred. Please check server logs for details.',
    });
  }
}
