import { GoogleGenAI } from '@google/genai';

function parseJsonBlock(rawText: string) {
  const cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const jsonText = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  return JSON.parse(jsonText);
}

function fallbackPayload(fileName: string) {
  const paperId = `paper_${Date.now()}`;
  const now = new Date().toISOString();
  return {
    paper: {
      paperId,
      title: fileName.replace(/\.pdf$/i, ''),
      sourceFile: fileName,
      keywords: ['manual-review-needed'],
      topics: [
        {
          topicId: `${paperId}_topic_1`,
          name: 'Unclassified Topic',
          keywords: ['manual-review-needed'],
          frequency: 1,
          weight: 0.5,
        },
      ],
      uploadedAt: now,
    },
    entries: [],
  };
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server env GEMINI_API_KEY is not configured.' });
  }

  const fileName = typeof req.body?.fileName === 'string' ? req.body.fileName : 'uploaded-paper.pdf';
  const fileDataBase64 = typeof req.body?.fileDataBase64 === 'string' ? req.body.fileDataBase64 : '';

  if (!fileDataBase64) {
    return res.status(400).json({ error: 'fileDataBase64 is required.' });
  }

  const paperId = `paper_${Date.now()}`;

  const prompt = `You are extracting a mathematical paper knowledge base from a PDF.
Return ONLY valid JSON with this exact schema:
{
  "paper": {
    "paperId": "${paperId}",
    "title": "paper title",
    "sourceFile": "${fileName}",
    "keywords": ["k1", "k2"],
    "topics": [
      {
        "topicId": "${paperId}_topic_1",
        "name": "topic name",
        "keywords": ["k1"],
        "frequency": 1,
        "weight": 0.5
      }
    ],
    "uploadedAt": "${new Date().toISOString()}"
  },
  "entries": [
    {
      "entryId": "${paperId}_thm_1",
      "paperId": "${paperId}",
      "type": "theorem",
      "label": "Theorem 1",
      "statement": "...",
      "proofSummary": "brief summary of how this is proved",
      "keywords": ["..."],
      "topics": ["${paperId}_topic_1"],
      "importance": 0.9,
      "citations": [
        {
          "paperId": "${paperId}",
          "paperTitle": "paper title",
          "pageStart": 1,
          "pageEnd": 1
        }
      ],
      "proofMethods": ["induction"],
      "prerequisites": ["Lemma 2.1", "Hoeffding inequality"],
      "mathematicalDomain": "probability"
    }
  ]
}
Rules:
- language must be English.
- Extract theorem/lemma/proposition/corollary and associated proofs when possible.
- "type" must be one of: "theorem", "lemma", "corollary", "proposition", "proof".
- "proofMethods" is an array of proof techniques used. Choose from: "induction", "contradiction", "construction", "direct", "contrapositive", "exhaustion", "probabilistic", "combinatorial", "algebraic", "analytic", "topological", "other".
- "prerequisites" lists the key lemmas, theorems, or tools that this entry depends on (e.g. "Hoeffding inequality", "Borel-Cantelli lemma").
- "mathematicalDomain" is the primary mathematical area. Choose from: "probability", "statistics", "analysis", "algebra", "topology", "combinatorics", "number theory", "optimization", "geometry", "logic", or a more specific subfield.
- Add multiple topics based on paper keywords.
- frequency is integer count; weight in [0,1].
- Keep statements concise but faithful.
- If uncertain, still return syntactically valid JSON with best effort.`;

  try {
    const genAI = new GoogleGenAI({ apiKey });
    const response = await genAI.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                data: fileDataBase64,
                mimeType: 'application/pdf',
              },
            },
          ],
        },
      ],
    });

    const text = response.text ?? '';
    const payload = parseJsonBlock(text);
    return res.status(200).json(payload);
  } catch (error) {
    console.error('ingest-paper failed:', error);
    return res.status(200).json(fallbackPayload(fileName));
  }
}
