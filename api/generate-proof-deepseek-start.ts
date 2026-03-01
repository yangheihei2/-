import { createProofJobState, stateToToken } from './deepseek-proof-job.js';

const defaultModel = 'deepseek-chat';

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

  if (!theorem.trim()) {
    return res.status(400).json({ error: 'Theorem is required.' });
  }

  const state = createProofJobState(theorem, assumptions, requestedModel);
  return res.status(202).json({
    status: 'in_progress',
    token: stateToToken(state),
    attempts: state.attempts,
  });
}
