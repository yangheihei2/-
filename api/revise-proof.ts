import { GoogleGenAI } from '@google/genai';

const defaultModel = 'gemini-2.5-flash';

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
  const feedback = typeof req.body?.feedback === 'string' ? req.body.feedback : '';
  const requestedModel = typeof req.body?.model === 'string' ? req.body.model : defaultModel;
  const model = requestedModel.startsWith('gemini-') ? requestedModel : defaultModel;

  if (!theorem.trim() || !proof.trim()) {
    return res.status(400).json({ error: 'Theorem and proof are required.' });
  }

  const prompt = `You are a proof reviser.
Theorem: ${theorem}
Assumptions: ${assumptions || '(none)'}
Current proof:\n${proof}
Verifier feedback:\n${feedback || '(none)'}

Revise only the minimum parts needed to address the feedback while preserving valid sections.
Return only the revised proof text suitable for MathJax rendering.
Do not include markdown fences or JSON.`;

  try {
    const genAI = new GoogleGenAI({ apiKey });
    const response = await genAI.models.generateContent({
      model,
      contents: prompt,
    });

    return res.status(200).json({ revisedProof: response.text ?? proof });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Gemini revision failed.' });
  }
}
