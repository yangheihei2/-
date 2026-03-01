import { runProofJobStep, stateFromToken } from '../lib/server/deepseek-proof-job.js';

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

  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  if (!token.trim()) {
    return res.status(400).json({ error: 'Job token is required.' });
  }

  try {
    const state = stateFromToken(token);
    const result = await runProofJobStep(apiKey, state);

    if (result.status === 'completed') {
      return res.status(200).json(result);
    }

    if (result.status === 'failed') {
      return res.status(502).json(result);
    }

    return res.status(202).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid job token.';
    return res.status(400).json({ error: message, errorCode: 'DEEPSEEK_JOB_TOKEN_INVALID' });
  }
}
