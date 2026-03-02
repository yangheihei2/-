import { GoogleGenAI } from '@google/genai';

const defaultModel = 'gemini-2.5-flash';

type VerifierDecision = 'PASS' | 'MINOR_FIX' | 'REGENERATE';

interface VerifyPayload {
  decision: VerifierDecision;
  feedback: string;
  riskLevel?: 'low' | 'medium' | 'high';
}

function normalizeBody(rawBody: unknown): Record<string, unknown> {
  if (rawBody && typeof rawBody === 'object') {
    return rawBody as Record<string, unknown>;
  }

  if (typeof rawBody === 'string') {
    try {
      const parsed = JSON.parse(rawBody);
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }

  return {};
}

function firstString(body: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === 'string') {
      return value;
    }
  }
  return '';
}

function extractGeminiErrorDetails(error: unknown) {
  const fallback = 'Gemini verification failed.';
  if (!error || typeof error !== 'object') {
    return fallback;
  }

  const status = typeof (error as { status?: unknown }).status === 'number'
    ? (error as { status: number }).status
    : undefined;
  const message = typeof (error as { message?: unknown }).message === 'string'
    ? (error as { message: string }).message
    : fallback;
  const nested = (error as { error?: { message?: unknown; status?: unknown } }).error;
  const nestedMessage = nested && typeof nested.message === 'string' ? nested.message : undefined;
  const nestedStatus = nested && typeof nested.status === 'string' ? nested.status : undefined;

  return [
    message,
    status ? `(HTTP ${status})` : undefined,
    nestedStatus ? `status=${nestedStatus}` : undefined,
    nestedMessage ? `detail=${nestedMessage}` : undefined,
  ].filter(Boolean).join(' ');
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
      // Gemini occasionally emits single backslashes (for example in LaTeX like "\to").
      // JSON requires unknown escape sequences to be double-escaped.
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

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server env GEMINI_API_KEY is not configured.' });
  }

  const body = normalizeBody(req.body);
  const theorem = firstString(body, ['theorem', 'theoremStatement', 'statement', 'theorem_statement']);
  const assumptions = firstString(body, ['assumptions']);
  const proof = firstString(body, ['proof', 'candidateProof', 'draftProof', 'candidate_proof', 'draft_proof']);
  const requestedModel = firstString(body, ['model']) || defaultModel;
  const model = requestedModel.startsWith('gemini-') ? requestedModel : defaultModel;

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
    const genAI = new GoogleGenAI({ apiKey });
    const response = await genAI.models.generateContent({
      model,
      contents: prompt,
    });

    const text = response.text ?? '{}';
    const payload = parseVerifierPayload(text);
    return res.status(200).json(payload);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: extractGeminiErrorDetails(error) });
  }
}
