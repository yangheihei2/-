import { GoogleGenAI } from '@google/genai';

const defaultModel = 'gemini-2.5-flash';

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
  const parsed = JSON.parse(jsonText);

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

  const theorem = typeof req.body?.theorem === 'string' ? req.body.theorem : '';
  const assumptions = typeof req.body?.assumptions === 'string' ? req.body.assumptions : '';
  const proof = typeof req.body?.proof === 'string' ? req.body.proof : '';
  const requestedModel = typeof req.body?.model === 'string' ? req.body.model : defaultModel;
  const model = requestedModel.startsWith('gemini-') ? requestedModel : defaultModel;

  if (!theorem.trim() || !proof.trim()) {
    return res.status(400).json({ error: 'Theorem and proof are required.' });
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
    return res.status(500).json({ error: 'Gemini verification failed.' });
  }
}
