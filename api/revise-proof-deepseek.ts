import { callAiModel, formatProviderName } from '../lib/ai-client.js';
import { DEFAULT_MODEL_ID, resolveModelId } from '../lib/model-config.js';

const defaultModel = DEFAULT_MODEL_ID;

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const theorem = typeof req.body?.theorem === 'string' ? req.body.theorem : '';
  const assumptions = typeof req.body?.assumptions === 'string' ? req.body.assumptions : '';
  const proof = typeof req.body?.proof === 'string' ? req.body.proof : '';
  const feedback = typeof req.body?.feedback === 'string' ? req.body.feedback : '';
  const requestedModel = typeof req.body?.model === 'string' ? req.body.model : defaultModel;
  const model = resolveModelId(requestedModel);

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
    const data = await callAiModel({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    });

    const revisedProof = data?.choices?.[0]?.message?.content;
    return res.status(200).json({ revisedProof: revisedProof ?? proof });
  } catch (error) {
    console.error(`${formatProviderName(model)} reviser error:`, error);
    const message = error instanceof Error ? error.message : `${formatProviderName(model)} revision failed.`;
    return res.status(500).json({
      error: message,
      errorCode: error instanceof Error && 'errorCode' in error ? (error as any).errorCode : undefined,
      userHint: error instanceof Error && 'userHint' in error ? (error as any).userHint : undefined,
    });
  }
}
