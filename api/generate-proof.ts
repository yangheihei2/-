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
  const requestedModel = typeof req.body?.model === 'string' ? req.body.model : defaultModel;
  const model = requestedModel.startsWith('gemini-') ? requestedModel : defaultModel;
  const knowledgeReferences = Array.isArray(req.body?.knowledgeReferences) ? req.body.knowledgeReferences : [];
  const literatureBrief = typeof req.body?.literatureBrief === 'string' ? req.body.literatureBrief : '';

  if (!theorem.trim()) {
    return res.status(400).json({ error: 'Theorem is required.' });
  }

  const literatureSection = literatureBrief
    ? `\nRelated academic literature:\n${literatureBrief}\n\nLeverage relevant methods, techniques, and results from these references in your proof where applicable.`
    : '';

  const prompt = `You are a mathematical proof assistant.
Theorem: ${theorem}
Assumptions: ${assumptions}
Knowledge-base references (sorted by weight, primary first): ${JSON.stringify(knowledgeReferences)}
${literatureSection}

Return a proof that can be directly rendered by MathJax in a web page.
Requirements:
1) Use readable sections: Theorem, Key Lemmas, Proof, and Conclusion.
2) Write normal text plus math expressions using \\(...\\) and \\[...\\].
3) Do not output full LaTeX document preamble (no \\documentclass, \\begin{document}, etc).
4) Keep the argument rigorous and concise.
5) End with \\qed or an explicit QED statement.
6) Prefer primary references from the knowledge base, but also cross-check with secondary references.
7) When using a reference idea, mention citation in format [Paper: <title>, pp.<start>-<end>].
8) When using a technique from the literature, briefly note which reference inspired it.
9) Response language: English.`;

  try {
    const genAI = new GoogleGenAI({ apiKey });
    const response = await genAI.models.generateContent({
      model,
      contents: prompt,
    });

    return res.status(200).json({ proof: response.text ?? 'Failed to generate proof.' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Gemini request failed. Please retry later.' });
  }
}
