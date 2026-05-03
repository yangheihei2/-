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
  source: 'rule' | 'manual';
}

const CROSSREF_API = 'https://api.crossref.org/works';
const ARXIV_API = 'https://export.arxiv.org/api/query';

const MATH_STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'are', 'from', 'then',
  'have', 'has', 'been', 'such', 'let', 'all', 'any', 'each', 'every',
  'where', 'which', 'when', 'there', 'given', 'show', 'prove', 'assume',
  'define', 'consider', 'suppose', 'note', 'also', 'thus', 'hence',
  'therefore', 'since', 'because', 'implies', 'follows', 'holds',
  'number', 'function', 'set', 'not', 'some', 'can', 'will', 'may',
  'must', 'shall', 'would', 'could', 'should', 'into', 'over', 'under',
  'above', 'below', 'between', 'through', 'during', 'before', 'after',
  'other', 'than', 'more', 'less', 'most', 'least', 'only', 'just',
  'both', 'either', 'neither', 'very', 'well', 'much', 'many',
]);

const MATH_TERM_PATTERNS = [
  /\b(convergence|converges?|diverge(?:nce|s)?)\b/gi,
  /\b(martingale|submartingale|supermartingale)\b/gi,
  /\b(inequality|inequalities|bound(?:s|ed)?|estimate(?:s|d)?)\b/gi,
  /\b(hoeffding|bernstein|chebyshev|markov|chernoff|mcdiarmid)\b/gi,
  /\b(borel[- ]cantelli|kolmogorov|lebesgue|riemann|cauchy|schwarz)\b/gi,
  /\b(induction|contradiction|contrapositive|exhaustion)\b/gi,
  /\b(probability|stochastic|random|measure|ergodic)\b/gi,
  /\b(banach|hilbert|sobolev|lipschitz|hausdorff)\b/gi,
  /\b(eigenvalue|eigenvector|spectral|determinant|rank)\b/gi,
  /\b(convex(?:ity)?|concave|optimization|minimiz|maximiz)\b/gi,
  /\b(topology|topological|manifold|homotopy|homology)\b/gi,
  /\b(group|ring|field|module|algebra(?:ic)?|ideal)\b/gi,
  /\b(graph|tree|matching|coloring|chromatic)\b/gi,
  /\b(regression|bayesian|likelihood|estimat(?:or|ion))\b/gi,
  /\b(theorem|lemma|proposition|corollary)\b/gi,
  /\b(almost sure(?:ly)?|a\.s\.|i\.i\.d\.|a\.e\.)\b/gi,
  /\b(order statistic|quantile|percentile|median)\b/gi,
  /\b(threshold|classification|error[- ]rate|false[- ]positive)\b/gi,
  /\b(concentration|tail bound|sub[- ]?gaussian|sub[- ]?exponential)\b/gi,
  /\b(hypothesis test|confidence interval|p[- ]?value|significance)\b/gi,
];

const ARXIV_CATEGORY_MAP: Record<string, string> = {
  'probability': 'math.PR',
  'statistics': 'stat.TH',
  'analysis': 'math.FA',
  'real analysis': 'math.CA',
  'functional analysis': 'math.FA',
  'algebra': 'math.RA',
  'linear algebra': 'math.RA',
  'topology': 'math.GN',
  'combinatorics': 'math.CO',
  'number theory': 'math.NT',
  'optimization': 'math.OC',
  'geometry': 'math.DG',
  'logic': 'math.LO',
  'machine learning': 'stat.ML',
  'computer science': 'cs.LG',
  'information theory': 'cs.IT',
};

function extractMathTerms(text: string): string[] {
  const terms = new Set<string>();
  for (const pattern of MATH_TERM_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      for (const m of matches) terms.add(m.toLowerCase().trim());
    }
  }
  return [...terms];
}

function extractStructuredKeywords(theorem: string, assumptions: string, researchField: string): string {
  const combined = `${theorem} ${assumptions} ${researchField}`;
  const mathTerms = extractMathTerms(combined);

  const generalTokens = combined
    .toLowerCase()
    .replace(/\\[a-z]+/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !MATH_STOP_WORDS.has(t));

  const uniqueGeneral = [...new Set(generalTokens)].filter((t) => !mathTerms.includes(t)).slice(0, 4);
  const allKeywords = [...mathTerms, ...uniqueGeneral].slice(0, 10);
  return allKeywords.join(', ');
}

function resolveArxivCategory(researchField: string): string | null {
  if (!researchField) return null;
  const lower = researchField.toLowerCase().trim();
  return ARXIV_CATEGORY_MAP[lower] ?? null;
}

function clip(text: string, maxLen = 180) {
  if (!text) return '';
  return text.length <= maxLen ? text : `${text.slice(0, maxLen - 1)}…`;
}

function sanitize(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

function extractArxivId(idOrUrl: string) {
  const match = idOrUrl.match(/(\d{4}\.\d{4,5})(v\d+)?$/);
  return match?.[1] ?? idOrUrl;
}

function multiDimensionScore(query: string, title: string, summary: string, researchField: string, year: number | null): number {
  const queryTerms = extractMathTerms(query);
  const queryTokens = query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !MATH_STOP_WORDS.has(t));
  const haystack = `${title.toLowerCase()} ${summary.toLowerCase()}`;

  let termScore = 0;
  if (queryTerms.length > 0) {
    let hits = 0;
    for (const term of queryTerms) {
      if (haystack.includes(term)) hits++;
    }
    termScore = hits / queryTerms.length;
  }

  let tokenScore = 0;
  if (queryTokens.length > 0) {
    let hits = 0;
    for (const token of queryTokens) {
      if (haystack.includes(token)) hits++;
    }
    tokenScore = hits / queryTokens.length;
  }

  const methodKeywords = ['induction', 'contradiction', 'bound', 'inequality', 'convergence', 'estimate', 'construction'];
  let methodScore = 0;
  const queryMethods = methodKeywords.filter((m) => query.toLowerCase().includes(m));
  if (queryMethods.length > 0) {
    let mHits = 0;
    for (const m of queryMethods) {
      if (haystack.includes(m)) mHits++;
    }
    methodScore = mHits / queryMethods.length;
  }

  let freshnessScore = 0.5;
  if (year) {
    const currentYear = new Date().getFullYear();
    const age = currentYear - year;
    freshnessScore = age <= 3 ? 1.0 : age <= 7 ? 0.7 : age <= 15 ? 0.4 : 0.2;
  }

  const raw = termScore * 0.30 + tokenScore * 0.25 + methodScore * 0.25 + freshnessScore * 0.20;
  return Math.min(0.99, 0.10 + raw * 0.89);
}

function parseArxivEntries(xml: string, query: string, researchField: string): LiteratureMatch[] {
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];

  return entries.map((entry) => {
    const title = sanitize((entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '').replace(/\n/g, ' '));
    const idRaw = sanitize(entry.match(/<id>([\s\S]*?)<\/id>/)?.[1] ?? '');
    const publishedRaw = sanitize(entry.match(/<published>([\s\S]*?)<\/published>/)?.[1] ?? '');
    const summary = sanitize((entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? ''));
    const authorMatches = [...entry.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((m) => sanitize(m[1]));
    const publishedYear = publishedRaw ? new Date(publishedRaw).getFullYear() : null;
    const id = extractArxivId(idRaw);

    const categories = [...entry.matchAll(/<category[^>]*term="([^"]+)"/g)].map((m) => m[1]);

    return {
      title: clip(title),
      authors: clip(authorMatches.join(', '), 90) || 'Unknown authors',
      source: publishedYear ? `arXiv (${publishedYear})` : 'arXiv',
      score: multiDimensionScore(query, title, summary, researchField, publishedYear),
      tags: ['arXiv', ...categories.slice(0, 2)],
      url: id ? `https://arxiv.org/abs/${id}` : idRaw,
    } satisfies LiteratureMatch;
  });
}

async function searchArxiv(query: string, researchField: string, limit: number) {
  const category = resolveArxivCategory(researchField);
  let searchQuery = `all:${encodeURIComponent(query)}`;
  if (category) {
    searchQuery += `+AND+cat:${category}`;
  }

  const url = `${ARXIV_API}?search_query=${searchQuery}&start=0&max_results=${limit}&sortBy=relevance&sortOrder=descending`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'theorem-workspace/2.0 (literature-search)' },
  });
  if (!res.ok) {
    throw new Error(`arXiv request failed with status ${res.status}`);
  }

  const xml = await res.text();
  return parseArxivEntries(xml, query, researchField);
}

async function searchCrossref(query: string, researchField: string, limit: number): Promise<LiteratureMatch[]> {
  const url = `${CROSSREF_API}?query.bibliographic=${encodeURIComponent(query)}&rows=${limit}&sort=score&order=desc&select=DOI,title,author,container-title,published-print,published-online,type,score,URL`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'theorem-workspace/2.0 (literature-search)',
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

    return {
      title: clip(title || 'Untitled record'),
      authors: clip(authors || 'Unknown authors', 90),
      source: year ? `${clip(venue, 40)} (${year})` : clip(venue, 40),
      score: multiDimensionScore(query, title, '', researchField, year),
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

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const theorem = typeof req.body?.theorem === 'string' ? req.body.theorem.trim() : '';
  const assumptions = typeof req.body?.assumptions === 'string' ? req.body.assumptions.trim() : '';
  const researchField = typeof req.body?.researchField === 'string' ? req.body.researchField.trim() : '';
  const manualKeywords = typeof req.body?.keywords === 'string' ? req.body.keywords.trim() : '';

  const baseQuery = [theorem, assumptions, researchField].filter(Boolean).join(' ').slice(0, 500);
  if (!baseQuery) {
    return res.status(200).json({
      literature: [],
      keywords: { suggested: '', used: '', source: 'rule' } satisfies KeywordExtractionResult,
    });
  }

  try {
    const suggestedKeywords = extractStructuredKeywords(theorem, assumptions, researchField);
    const usedKeywords = manualKeywords || suggestedKeywords;
    const query = [usedKeywords, researchField].filter(Boolean).join(' ').slice(0, 500);

    const [arxivMatches, crossrefMatches] = await Promise.all([
      searchArxiv(query, researchField, 6),
      searchCrossref(query, researchField, 6),
    ]);

    const literature = dedupeAndRank([...arxivMatches, ...crossrefMatches], 8);
    return res.status(200).json({
      literature,
      keywords: {
        suggested: suggestedKeywords,
        used: usedKeywords,
        source: manualKeywords ? 'manual' : 'rule',
      } satisfies KeywordExtractionResult,
    });
  } catch (error) {
    console.error('Literature search failed:', error);
    return res.status(502).json({ error: 'Literature search provider unavailable.' });
  }
}
