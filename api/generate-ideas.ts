import { GoogleGenAI } from '@google/genai';

const defaultModel = 'gemini-2.5-flash';

function parseIdeasPayload(rawText: string) {
  const cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const jsonText = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  const parsed = JSON.parse(jsonText);

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

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server env GEMINI_API_KEY is not configured.' });
  }

  const theorem = typeof req.body?.theorem === 'string' ? req.body.theorem : '';
  const assumptions = typeof req.body?.assumptions === 'string' ? req.body.assumptions : '';
  const literature = Array.isArray(req.body?.literature) ? req.body.literature : [];
  const requestedModel = typeof req.body?.model === 'string' ? req.body.model : defaultModel;
  const model = requestedModel.startsWith('gemini-') ? requestedModel : defaultModel;

  if (!theorem.trim()) {
    return res.status(200).json({ ideas: [], candidateTheorems: [] });
  }

  const prompt = `You are a rigorous math reasoning assistant.
Given workspace content, propose proof ideas and candidate theorems that directly match this problem.

Theorem statement:\n${theorem}
Known assumptions:\n${assumptions || '(none)'}
Literature candidates:\n${JSON.stringify(literature)}

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
- if theorem is about a.s. convergence => convergence in probability, include the key epsilon-event argument.
- response language: English.`;

  try {
    const genAI = new GoogleGenAI({ apiKey });
    const response = await genAI.models.generateContent({
      model,
      contents: prompt,
    });

    const text = response.text ?? '{}';
    const payload = parseIdeasPayload(text);
    return res.status(200).json(payload);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Gemini ideas generation failed.' });
  }
}
