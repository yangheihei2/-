import { PDFParse } from 'pdf-parse';
import { callDeepSeek } from '../lib/deepseek-client.js';

const defaultModel = 'deepseek-v4-pro';
const allowedModels = new Set(['deepseek-v4-pro', 'deepseek-v4-flash']);
const MAX_PDF_TEXT_CHARS = 60000;

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

async function extractPdfText(fileDataBase64: string) {
  const parser = new PDFParse({ data: Buffer.from(fileDataBase64, 'base64') });
  try {
    const result = await parser.getText();
    return result.text.replace(/\s+/g, ' ').trim().slice(0, MAX_PDF_TEXT_CHARS);
  } finally {
    await parser.destroy();
  }
}

function extractMessageContent(data: any) {
  const raw = data?.choices?.[0]?.message?.content;
  return typeof raw === 'string' ? raw : '';
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server env DEEPSEEK_API_KEY is not configured.' });
  }

  const fileName = typeof req.body?.fileName === 'string' ? req.body.fileName : 'uploaded-paper.pdf';
  const fileDataBase64 = typeof req.body?.fileDataBase64 === 'string' ? req.body.fileDataBase64 : '';
  const requestedModel = typeof req.body?.model === 'string' ? req.body.model : defaultModel;
  const model = allowedModels.has(requestedModel) ? requestedModel : defaultModel;

  if (!fileDataBase64) {
    return res.status(400).json({ error: 'fileDataBase64 is required.' });
  }

  const paperId = `paper_${Date.now()}`;

  let pdfText = '';
  try {
    pdfText = await extractPdfText(fileDataBase64);
  } catch (error) {
    console.error('PDF text extraction failed:', error);
  }

  const prompt = `You are extracting a mathematical paper knowledge base from PDF text.
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
- Do not include an "importance" field. The app calculates importance later from the user's theorem, assumptions, and reference relevance.
- Add multiple topics based on paper keywords.
- frequency is integer count; weight in [0,1].
- Keep statements concise but faithful.
- If uncertain, still return syntactically valid JSON with best effort.

PDF file name: ${fileName}
Extracted PDF text:
${pdfText || '(No extractable text found. Return a syntactically valid fallback using the file name.)'}`;

  try {
    const response = await callDeepSeek({
      apiKey,
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      requestTimeoutMs: 180000,
      maxRetries: 0,
    });

    const text = extractMessageContent(response);
    const payload = parseJsonBlock(text);
    return res.status(200).json(payload);
  } catch (error) {
    console.error('ingest-paper failed:', error);
    return res.status(200).json(fallbackPayload(fileName));
  }
}
