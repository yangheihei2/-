import { callDeepSeek } from '../lib/deepseek-client.js';

const defaultModel = 'deepseek-chat';
const allowedModels = new Set(['deepseek-chat', 'deepseek-reasoner']);

type VerifierDecision = 'PASS' | 'MINOR_FIX' | 'REGENERATE';

interface VerifyPayload {
  decision: VerifierDecision;
  feedback: string;
  riskLevel?: 'low' | 'medium' | 'high';
}

function parseVerifierPayload(rawText: string): VerifyPayload {
  const cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const jsonText = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  const parseJsonWithBackslashFallback = (text: string) => {
    try {
      return JSON.parse(text);
    } catch {
      const escapedBackslashes = text.replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
      return JSON.parse(escapedBackslashes);
    }
  };

  const parsed = parseJsonWithBackslashFallback(jsonText);

  const decision = parsed?.decision;
  const safeDecision: VerifierDecision = decision === 'PASS' || decision === 'MINOR_FIX' || decision === 'REGENERATE' ? decision : 'REGENERATE';
  const feedback = typeof parsed?.feedback === 'string' && parsed.feedback.trim() ? parsed.feedback.trim() : 'Unable to verify the candidate proof with confidence.';
  const riskLevel = parsed?.riskLevel === 'low' || parsed?.riskLevel === 'medium' || parsed?.riskLevel === 'high' ? parsed.riskLevel : undefined;

  return { decision: safeDecision, feedback, riskLevel };
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server env DEEPSEEK_API_KEY is not configured.' });
  }

  const theorem = typeof req.body?.theorem === 'string'
    ? req.body.theorem
    : typeof req.body?.theoremStatement === 'string'
      ? req.body.theoremStatement
      : typeof req.body?.statement === 'string'
        ? req.body.statement
        : '';
  const assumptions = typeof req.body?.assumptions === 'string' ? req.body.assumptions : '';
  const proof = typeof req.body?.proof === 'string'
    ? req.body.proof
    : typeof req.body?.candidateProof === 'string'
      ? req.body.candidateProof
      : typeof req.body?.draftProof === 'string'
        ? req.body.draftProof
        : '';
  const requestedModel = typeof req.body?.model === 'string' ? req.body.model : defaultModel;
  const model = allowedModels.has(requestedModel) ? requestedModel : defaultModel;

  const missingFields = [
    !theorem.trim() ? 'theorem' : null,
    !proof.trim() ? 'proof' : null,
  ].filter(Boolean);

  if (missingFields.length > 0) {
    return res.status(400).json({
      error: `Missing required field(s): ${missingFields.join(', ')}. Accepted theorem keys: theorem/theoremStatement/statement. Accepted proof keys: proof/candidateProof/draftProof.`,
    });
  }

  const prompt = `You are a strict mathematical verifier.
Theorem: ${theorem}
Assumptions: ${assumptions || '(none)'}
Candidate proof:\n${proof}

Return ONLY JSON using schema:
{
  "decision": "PASS" | "MINOR_FIX" | "REGENERATE",
  "feedback": "short actionable reason",
  "riskLevel": "low" | "medium" | "high"
}

Rules:
- PASS only if the argument is logically valid and complete.
- MINOR_FIX only if local edits can fix the proof.
- REGENERATE if there are structural or critical logic flaws.
- feedback must mention the most important issue succinctly.`;

  try {
    const data = await callDeepSeek({
      apiKey,
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
    });

    const text = data?.choices?.[0]?.message?.content ?? '{}';
    const payload = parseVerifierPayload(text);
    return res.status(200).json(payload);
  } catch (error) {
    console.error('DeepSeek verifier error:', error);
    const message = error instanceof Error ? error.message : 'DeepSeek verification failed.';
    return res.status(500).json({ error: message });
  }
}
