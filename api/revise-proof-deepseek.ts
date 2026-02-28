import { callDeepSeek } from './deepseek-client';

const defaultModel = 'deepseek-chat';
const allowedModels = new Set(['deepseek-chat', 'deepseek-reasoner']);

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server env DEEPSEEK_API_KEY is not configured.' });
  }

  const theorem = typeof req.body?.theorem === 'string' ? req.body.theorem : '';
  const assumptions = typeof req.body?.assumptions === 'string' ? req.body.assumptions : '';
  const proof = typeof req.body?.proof === 'string' ? req.body.proof : '';
  const feedback = typeof req.body?.feedback === 'string' ? req.body.feedback : '';
  const requestedModel = typeof req.body?.model === 'string' ? req.body.model : defaultModel;
  const model = allowedModels.has(requestedModel) ? requestedModel : defaultModel;

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
    const data = await callDeepSeek({
      apiKey,
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    });

    const revisedProof = data?.choices?.[0]?.message?.content;
    return res.status(200).json({ revisedProof: revisedProof ?? proof });
  } catch (error) {
    console.error('DeepSeek reviser error:', error);
    const message = error instanceof Error ? error.message : 'DeepSeek revision failed.';
    return res.status(500).json({ error: message });
  }
}
