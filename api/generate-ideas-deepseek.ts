import { callAiModel, formatProviderName } from '../lib/ai-client.js';
import { DEFAULT_MODEL_ID, resolveModelId } from '../lib/model-config.js';

const defaultModel = DEFAULT_MODEL_ID;

function parseIdeasPayload(rawText: string) {
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

  const ideas = Array.isArray(parsed?.ideas)
    ? parsed.ideas.filter((item: unknown) => typeof item === 'string').slice(0, 6)
    : [];

  const candidateTheorems = Array.isArray(parsed?.candidateTheorems)
    ? parsed.candidateTheorems
        .filter((item: unknown) => typeof item === 'object' && item !== null)
        .map((item: any) => ({
          name: typeof item.name === 'string' ? item.name : '',
          why: typeof item.why === 'string' ? item.why : '',
        }))
        .filter((item: { name: string; why: string }) => item.name && item.why)
        .slice(0, 4)
    : [];

  return { ideas, candidateTheorems };
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const theorem = typeof req.body?.theorem === 'string' ? req.body.theorem : '';
  const assumptions = typeof req.body?.assumptions === 'string' ? req.body.assumptions : '';
  const literatureBrief = typeof req.body?.literatureBrief === 'string' ? req.body.literatureBrief : '';
  const knowledgeReferences = Array.isArray(req.body?.knowledgeReferences) ? req.body.knowledgeReferences : [];
  const requestedModel = typeof req.body?.model === 'string' ? req.body.model : defaultModel;
  const model = resolveModelId(requestedModel);

  if (!theorem.trim()) {
    return res.status(200).json({ ideas: [], candidateTheorems: [] });
  }

  const literatureSection = literatureBrief
    ? `\nRelated academic literature:\n${literatureBrief}\n\nUse these references to ground your proof ideas in established methods and results.`
    : '';

  const prompt = `You are a rigorous math reasoning assistant.
Given workspace content, propose proof ideas and candidate theorems that directly match this problem.

Theorem statement:\n${theorem}
Known assumptions:\n${assumptions || '(none)'}
${literatureSection}
Knowledge-base references (weighted):\n${JSON.stringify(knowledgeReferences)}

Return ONLY JSON with this schema:
{
  "ideas": ["idea 1", "idea 2", "idea 3"],
  "candidateTheorems": [
    {"name": "theorem name", "why": "one-sentence reason tied to this theorem"}
  ]
}

Requirements:
- ideas must be specific to this theorem statement, not generic templates.
- keep 3-5 ideas and up to 3 candidate theorems.
- when literature references are provided, incorporate relevant methods and results from them into your ideas.
- response language: English.`;

  try {
    const data = await callAiModel({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    });

    const text = data?.choices?.[0]?.message?.content ?? '{}';
    const payload = parseIdeasPayload(text);
    return res.status(200).json(payload);
  } catch (error) {
    console.error(`${formatProviderName(model)} ideas error:`, error);
    const message = error instanceof Error ? error.message : `${formatProviderName(model)} ideas generation failed.`;
    return res.status(500).json({
      error: message,
      errorCode: error instanceof Error && 'errorCode' in error ? (error as any).errorCode : undefined,
      userHint: error instanceof Error && 'userHint' in error ? (error as any).userHint : undefined,
    });
  }
}
