import { GoogleGenAI } from '@google/genai';
import { callDeepSeek } from '../lib/deepseek-client.js';

interface LiteratureMatch {
  title: string;
  authors: string;
  source: string;
  score: number;
  tags: string[];
  url?: string;
}

interface KeywordExtractionResult {
  suggested: string;
  used: string;
  source: 'ai' | 'fallback' | 'manual';
}

const CROSSREF_API = 'https://api.crossref.org/works';
const ARXIV_API = 'https://export.arxiv.org/api/query';


type KeywordModelProvider = 'gemini' | 'deepseek';

function inferProviderFromModel(model: string): KeywordModelProvider {
  if (model.startsWith('deepseek-')) return 'deepseek';
  return 'gemini';
}

function buildKeywordPrompt(theorem: string, assumptions: string, researchField: string) {
  return `You summarize search keywords for academic literature retrieval.
Return ONLY one line of comma-separated keywords.

Problem statement:
${theorem}
Assumptions:
${assumptions || '(none)'}
Target research field:
${researchField || '(not specified)'}

Rules:
- Output 4-10 concise keywords/phrases.
- Prioritize domain-specific terms and methods.
- Include field hint if provided.
- No numbering, no explanation, no markdown.`;
}

function clip(text: string, maxLen = 180) {
  if (!text) return '';
  return text.length <= maxLen ? text : `${text.slice(0, maxLen - 1)}…`;
}

function sanitize(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

function scoreFromQuery(query: string, haystack: string) {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);

  if (terms.length === 0) return 0.5;

  let matches = 0;
  for (const term of terms) {
    if (haystack.includes(term)) matches += 1;
  }

  return Math.min(0.99, 0.45 + (matches / terms.length) * 0.5);
}

function extractArxivId(idOrUrl: string) {
  const match = idOrUrl.match(/(\d{4}\.\d{4,5})(v\d+)?$/);
  return match?.[1] ?? idOrUrl;
}

function parseArxivEntries(xml: string, query: string): LiteratureMatch[] {
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];

  return entries.map((entry) => {
    const title = sanitize((entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '').replace(/\n/g, ' '));
    const idRaw = sanitize(entry.match(/<id>([\s\S]*?)<\/id>/)?.[1] ?? '');
    const publishedRaw = sanitize(entry.match(/<published>([\s\S]*?)<\/published>/)?.[1] ?? '');
    const summary = sanitize((entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? '').toLowerCase());
    const authorMatches = [...entry.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((m) => sanitize(m[1]));
    const publishedYear = publishedRaw ? new Date(publishedRaw).getFullYear() : null;
    const id = extractArxivId(idRaw);

    return {
      title: clip(title),
      authors: clip(authorMatches.join(', '), 90) || 'Unknown authors',
      source: publishedYear ? `arXiv (${publishedYear})` : 'arXiv',
      score: scoreFromQuery(query, `${title.toLowerCase()} ${summary}`),
      tags: ['arXiv', 'Open Access'],
      url: id ? `https://arxiv.org/abs/${id}` : idRaw,
    } satisfies LiteratureMatch;
  });
}

async function searchArxiv(query: string, limit: number) {
  const url = `${ARXIV_API}?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${limit}&sortBy=relevance&sortOrder=descending`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'theorem-workspace/1.0 (literature-search)',
    },
  });
  if (!res.ok) {
    throw new Error(`arXiv request failed with status ${res.status}`);
  }

  const xml = await res.text();
  return parseArxivEntries(xml, query);
}

async function searchCrossref(query: string, limit: number): Promise<LiteratureMatch[]> {
  const url = `${CROSSREF_API}?query.bibliographic=${encodeURIComponent(query)}&rows=${limit}&sort=score&order=desc&select=DOI,title,author,container-title,published-print,published-online,type,score,URL`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'theorem-workspace/1.0 (literature-search)',
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(`Crossref request failed with status ${res.status}`);
  }

  const data = await res.json();
  const items = Array.isArray(data?.message?.items) ? data.message.items : [];

  return items.map((item: any) => {
    const title = sanitize(Array.isArray(item?.title) ? item.title[0] || '' : '');
    const authors = Array.isArray(item?.author)
      ? item.author
          .map((author: any) => [author?.given, author?.family].filter(Boolean).join(' '))
          .filter(Boolean)
          .join(', ')
      : '';

    const yearParts = item?.['published-print']?.['date-parts'] || item?.['published-online']?.['date-parts'];
    const year = Array.isArray(yearParts) && Array.isArray(yearParts[0]) ? yearParts[0][0] : null;

    const venue = Array.isArray(item?.['container-title']) ? item['container-title'][0] || 'Crossref' : 'Crossref';
    const crossrefScore = Number.isFinite(item?.score) ? Number(item.score) : 0;
    const normalized = Math.min(0.99, 0.4 + Math.log10(Math.max(1, crossrefScore + 1)) / 3);

    return {
      title: clip(title || 'Untitled record'),
      authors: clip(authors || 'Unknown authors', 90),
      source: year ? `${clip(venue, 40)} (${year})` : clip(venue, 40),
      score: normalized,
      tags: ['Crossref', item?.type ? String(item.type) : 'Metadata'],
      url: typeof item?.URL === 'string' ? item.URL : undefined,
    } satisfies LiteratureMatch;
  });
}

function dedupeAndRank(records: LiteratureMatch[], limit: number) {
  const deduped = new Map<string, LiteratureMatch>();

  for (const record of records) {
    const key = sanitize(record.title).toLowerCase();
    const existing = deduped.get(key);
    if (!existing || record.score > existing.score) {
      deduped.set(key, record);
    }
  }

  return [...deduped.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function fallbackKeywords(theorem: string, assumptions: string, researchField: string) {
  const raw = [theorem, assumptions, researchField].join(' ').toLowerCase();
  const tokens = raw
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4)
    .filter((token, index, arr) => arr.indexOf(token) === index)
    .slice(0, 8);
  return tokens.join(', ');
}

async function extractKeywordsWithAI(theorem: string, assumptions: string, researchField: string, model: string) {
  const provider = inferProviderFromModel(model);
  const prompt = buildKeywordPrompt(theorem, assumptions, researchField);

  if (provider === 'deepseek') {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return fallbackKeywords(theorem, assumptions, researchField);
    }

    try {
      const data = await callDeepSeek({
        apiKey,
        model,
        messages: [
          { role: 'system', content: 'You output only compact comma-separated keywords.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
      });
      const text = String(data?.choices?.[0]?.message?.content || '').replace(/\n+/g, ' ').trim();
      return text || fallbackKeywords(theorem, assumptions, researchField);
    } catch (error) {
      console.warn('DeepSeek keyword extraction failed, using fallback keywords:', error);
      return fallbackKeywords(theorem, assumptions, researchField);
    }
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return fallbackKeywords(theorem, assumptions, researchField);
  }

  try {
    const genAI = new GoogleGenAI({ apiKey });
    const response = await genAI.models.generateContent({
      model: model.startsWith('gemini-') ? model : 'gemini-2.5-flash',
      contents: prompt,
    });
    const text = (response.text || '').replace(/\n+/g, ' ').trim();
    return text || fallbackKeywords(theorem, assumptions, researchField);
  } catch (error) {
    console.warn('Gemini keyword extraction failed, using fallback keywords:', error);
    return fallbackKeywords(theorem, assumptions, researchField);
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const theorem = typeof req.body?.theorem === 'string' ? req.body.theorem.trim() : '';
  const assumptions = typeof req.body?.assumptions === 'string' ? req.body.assumptions.trim() : '';
  const researchField = typeof req.body?.researchField === 'string' ? req.body.researchField.trim() : '';
  const manualKeywords = typeof req.body?.keywords === 'string' ? req.body.keywords.trim() : '';
  const requestedModel = typeof req.body?.model === 'string' ? req.body.model.trim() : 'gemini-2.5-flash';
  const keywordProvider = inferProviderFromModel(requestedModel);

  const baseQuery = [theorem, assumptions, researchField].filter(Boolean).join(' ').slice(0, 500);
  if (!baseQuery) {
    return res.status(200).json({
      literature: [],
      keywords: {
        suggested: '',
        used: '',
        source: 'fallback',
      } satisfies KeywordExtractionResult,
    });
  }

  try {
    const suggestedKeywords = await extractKeywordsWithAI(theorem, assumptions, researchField, requestedModel);
    const usedKeywords = manualKeywords || suggestedKeywords;
    const query = [usedKeywords, researchField].filter(Boolean).join(' ').slice(0, 500);

    const [arxivMatches, crossrefMatches] = await Promise.all([
      searchArxiv(query, 6),
      searchCrossref(query, 6),
    ]);

    const literature = dedupeAndRank([...arxivMatches, ...crossrefMatches], 8);
    return res.status(200).json({
      literature,
      keywords: {
        suggested: suggestedKeywords,
        used: usedKeywords,
        source: manualKeywords
          ? 'manual'
          : (keywordProvider === 'deepseek' ? !!process.env.DEEPSEEK_API_KEY : !!process.env.GEMINI_API_KEY)
            ? 'ai'
            : 'fallback',
      } satisfies KeywordExtractionResult,
    });
  } catch (error) {
    console.error('Literature search failed:', error);
    return res.status(502).json({ error: 'Literature search provider unavailable.' });
  }
}
