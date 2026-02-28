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

  if (!theorem.trim()) {
    return res.status(400).json({ error: 'Theorem is required.' });
  }

  const prompt = `You are a mathematical proof assistant.
Theorem: ${theorem}
Assumptions: ${assumptions}

Return a proof that can be directly rendered by MathJax in a web page.
Requirements:
1) Use readable sections: Theorem, Key Lemmas, Proof, and Conclusion.
2) Write normal text plus math expressions using \(...\) and \[...\].
3) Do not output full LaTeX document preamble (no \documentclass, \begin{document}, etc).
4) Keep the argument rigorous and concise.
5) End with \qed or an explicit QED statement.`;

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
