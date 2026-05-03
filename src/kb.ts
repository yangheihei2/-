export type ProofEntryType = 'theorem' | 'proof' | 'lemma' | 'corollary' | 'proposition';

export type ProofMethod =
  | 'induction'
  | 'contradiction'
  | 'construction'
  | 'direct'
  | 'contrapositive'
  | 'exhaustion'
  | 'probabilistic'
  | 'combinatorial'
  | 'algebraic'
  | 'analytic'
  | 'topological'
  | 'other';

export interface CitationRef {
  paperId: string;
  paperTitle: string;
  pageStart: number;
  pageEnd: number;
}

export interface KnowledgeEntry {
  entryId: string;
  paperId: string;
  type: ProofEntryType;
  label: string;
  statement: string;
  proofSummary: string;
  keywords: string[];
  topics: string[];
  importance?: number;
  citations: CitationRef[];
  proofMethods: ProofMethod[];
  prerequisites: string[];
  mathematicalDomain: string;
}

export interface PaperTopic {
  topicId: string;
  name: string;
  keywords: string[];
  frequency: number;
  weight: number;
}

export interface PaperRecord {
  paperId: string;
  title: string;
  sourceFile: string;
  keywords: string[];
  topics: PaperTopic[];
  uploadedAt: string;
}

export interface KnowledgeBase {
  kb_meta: {
    kb_id: string;
    name: string;
    version: string;
    language: 'en';
    created_at: string;
    updated_at: string;
    schema_version: '1.0' | '2.0';
  };
  settings: {
    weight_formula: {
      topic_frequency: number;
      keyword_match: number;
      semantic_similarity: number;
      theorem_importance: number;
      proof_method_match: number;
      domain_match: number;
    };
    top_k_primary: number;
    top_k_secondary: number;
  };
  papers: PaperRecord[];
  entries: KnowledgeEntry[];
}

export interface RankedReference {
  entry: KnowledgeEntry;
  score: number;
  scoreBreakdown: {
    topicFrequency: number;
    keywordMatch: number;
    semanticSimilarity: number;
    theoremImportance: number;
    proofMethodMatch: number;
    domainMatch: number;
  };
  role: 'primary' | 'secondary';
}

export interface IngestedPaperPayload {
  paper: PaperRecord;
  entries: KnowledgeEntry[];
}

export function createEmptyKnowledgeBase(name = 'My Proof KB'): KnowledgeBase {
  const now = new Date().toISOString();
  return {
    kb_meta: {
      kb_id: `kb_${Date.now()}`,
      name,
      version: '2.0.0',
      language: 'en',
      created_at: now,
      updated_at: now,
      schema_version: '2.0',
    },
    settings: {
      weight_formula: {
        topic_frequency: 0.15,
        keyword_match: 0.20,
        semantic_similarity: 0.20,
        theorem_importance: 0.10,
        proof_method_match: 0.20,
        domain_match: 0.15,
      },
      top_k_primary: 3,
      top_k_secondary: 10,
    },
    papers: [],
    entries: [],
  };
}

export function migrateEntry(entry: any): KnowledgeEntry {
  const migrated: KnowledgeEntry = {
    entryId: entry.entryId ?? '',
    paperId: entry.paperId ?? '',
    type: entry.type ?? 'theorem',
    label: entry.label ?? '',
    statement: entry.statement ?? '',
    proofSummary: entry.proofSummary ?? '',
    keywords: Array.isArray(entry.keywords) ? entry.keywords : [],
    topics: Array.isArray(entry.topics) ? entry.topics : [],
    citations: Array.isArray(entry.citations) ? entry.citations : [],
    proofMethods: Array.isArray(entry.proofMethods) ? entry.proofMethods : [],
    prerequisites: Array.isArray(entry.prerequisites) ? entry.prerequisites : [],
    mathematicalDomain: typeof entry.mathematicalDomain === 'string' ? entry.mathematicalDomain : '',
  };
  if (typeof entry.importance === 'number') {
    migrated.importance = entry.importance;
  }
  return migrated;
}

export function migrateKnowledgeBase(raw: any): KnowledgeBase {
  const kb = raw as KnowledgeBase;
  const settings = kb.settings ?? createEmptyKnowledgeBase().settings;
  if (!settings.weight_formula.proof_method_match) {
    settings.weight_formula = {
      ...createEmptyKnowledgeBase().settings.weight_formula,
      ...settings.weight_formula,
    };
  }
  return {
    ...kb,
    kb_meta: { ...kb.kb_meta, schema_version: '2.0' },
    settings,
    entries: (kb.entries ?? []).map(migrateEntry),
  };
}

export function mergePaperIntoKnowledgeBase(kb: KnowledgeBase, payload: IngestedPaperPayload): KnowledgeBase {
  const nextPapers = [...kb.papers.filter((p) => p.paperId !== payload.paper.paperId), payload.paper];
  const migratedEntries = payload.entries.map(migrateEntry);
  const nextEntries = [...kb.entries.filter((e) => e.paperId !== payload.paper.paperId), ...migratedEntries];
  return {
    ...kb,
    kb_meta: {
      ...kb.kb_meta,
      updated_at: new Date().toISOString(),
    },
    papers: nextPapers,
    entries: nextEntries,
  };
}

const MATH_STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'are', 'from', 'then',
  'have', 'has', 'been', 'such', 'let', 'all', 'any', 'each', 'every',
  'where', 'which', 'when', 'there', 'given', 'show', 'prove', 'assume',
  'define', 'consider', 'suppose', 'note', 'also', 'thus', 'hence',
  'therefore', 'since', 'because', 'implies', 'follows', 'holds',
  'number', 'function', 'set', 'not', 'some',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\\[a-z]+/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !MATH_STOP_WORDS.has(t));
}

function bigrams(tokens: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    result.push(`${tokens[i]}_${tokens[i + 1]}`);
  }
  return result;
}

function computeIdf(corpus: string[][]): Map<string, number> {
  const docCount = corpus.length;
  const df = new Map<string, number>();
  for (const doc of corpus) {
    const seen = new Set(doc);
    for (const token of seen) {
      df.set(token, (df.get(token) ?? 0) + 1);
    }
  }
  const idf = new Map<string, number>();
  for (const [token, count] of df) {
    idf.set(token, Math.log((docCount + 1) / (count + 1)) + 1);
  }
  return idf;
}

function tfidfVector(tokens: string[], idf: Map<string, number>): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) {
    tf.set(t, (tf.get(t) ?? 0) + 1);
  }
  const vec = new Map<string, number>();
  for (const [term, count] of tf) {
    const termIdf = idf.get(term) ?? 1;
    vec.set(term, (count / tokens.length) * termIdf);
  }
  return vec;
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [key, val] of a) {
    normA += val * val;
    const bVal = b.get(key);
    if (bVal !== undefined) dot += val * bVal;
  }
  for (const [, val] of b) normB += val * val;
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function scoreKeywordMatch(entryKeywords: string[], queryTokens: string[], idf: Map<string, number>): number {
  if (entryKeywords.length === 0 || queryTokens.length === 0) return 0;
  const entrySet = new Set(entryKeywords.map((x) => x.toLowerCase()));
  let weightedHit = 0;
  let totalWeight = 0;
  for (const token of queryTokens) {
    const w = idf.get(token) ?? 1;
    totalWeight += w;
    if (entrySet.has(token)) weightedHit += w;
  }
  return totalWeight > 0 ? Math.min(1, weightedHit / totalWeight) : 0;
}

function scoreSemanticSimilarity(entry: KnowledgeEntry, queryTokens: string[], idf: Map<string, number>): number {
  const contentTokens = tokenize(`${entry.statement} ${entry.proofSummary} ${entry.prerequisites.join(' ')}`);
  const allContentTokens = [...contentTokens, ...bigrams(contentTokens)];
  const allQueryTokens = [...queryTokens, ...bigrams(queryTokens)];
  const vecA = tfidfVector(allQueryTokens, idf);
  const vecB = tfidfVector(allContentTokens, idf);
  return cosineSimilarity(vecA, vecB);
}

const PROOF_METHOD_KEYWORDS: Record<ProofMethod, string[]> = {
  induction: ['induction', 'inductive', 'base case', 'inductive step', 'recursive'],
  contradiction: ['contradiction', 'contradict', 'absurd', 'suppose not', 'assume contrary'],
  construction: ['construct', 'construction', 'constructive', 'exhibit', 'build'],
  direct: ['direct', 'straightforward', 'directly'],
  contrapositive: ['contrapositive', 'converse'],
  exhaustion: ['exhaustion', 'case analysis', 'cases', 'enumerate'],
  probabilistic: ['probabilistic', 'probability', 'random', 'expectation', 'measure'],
  combinatorial: ['combinatorial', 'combinatorics', 'counting', 'pigeonhole', 'enumeration'],
  algebraic: ['algebraic', 'algebra', 'polynomial', 'ring', 'field', 'group'],
  analytic: ['analytic', 'analysis', 'convergence', 'limit', 'continuity', 'epsilon', 'delta', 'bound'],
  topological: ['topological', 'topology', 'open', 'closed', 'compact', 'connected'],
  other: [],
};

function detectProofMethods(text: string): ProofMethod[] {
  const lower = text.toLowerCase();
  const detected: ProofMethod[] = [];
  for (const [method, keywords] of Object.entries(PROOF_METHOD_KEYWORDS) as [ProofMethod, string[]][]) {
    if (method === 'other') continue;
    if (keywords.some((kw) => lower.includes(kw))) {
      detected.push(method);
    }
  }
  return detected;
}

function scoreProofMethodMatch(entryMethods: ProofMethod[], queryText: string): number {
  if (entryMethods.length === 0) return 0;
  const queryMethods = detectProofMethods(queryText);
  if (queryMethods.length === 0) return 0.3;
  const entrySet = new Set(entryMethods);
  let hit = 0;
  for (const m of queryMethods) {
    if (entrySet.has(m)) hit++;
  }
  return Math.min(1, hit / queryMethods.length);
}

const DOMAIN_ALIASES: Record<string, string[]> = {
  'probability': ['probability', 'stochastic', 'random', 'measure theory', 'martingale'],
  'statistics': ['statistics', 'statistical', 'estimation', 'hypothesis', 'regression', 'bayesian'],
  'analysis': ['analysis', 'real analysis', 'functional analysis', 'convergence', 'continuity'],
  'algebra': ['algebra', 'linear algebra', 'abstract algebra', 'group theory', 'ring theory'],
  'topology': ['topology', 'topological', 'manifold', 'homotopy'],
  'combinatorics': ['combinatorics', 'combinatorial', 'graph theory', 'discrete'],
  'number theory': ['number theory', 'prime', 'diophantine', 'modular arithmetic'],
  'optimization': ['optimization', 'convex', 'linear programming', 'variational'],
  'geometry': ['geometry', 'geometric', 'euclidean', 'differential geometry'],
  'logic': ['logic', 'model theory', 'set theory', 'computability'],
};

function scoreDomainMatch(entryDomain: string, queryText: string): number {
  if (!entryDomain) return 0;
  const lower = queryText.toLowerCase();
  const entryDomainLower = entryDomain.toLowerCase();

  if (lower.includes(entryDomainLower)) return 1;

  for (const [, aliases] of Object.entries(DOMAIN_ALIASES)) {
    const entryMatch = aliases.some((a) => entryDomainLower.includes(a));
    const queryMatch = aliases.some((a) => lower.includes(a));
    if (entryMatch && queryMatch) return 0.8;
  }
  return 0;
}

function scoreDynamicImportance(
  entry: KnowledgeEntry,
  keywordMatch: number,
  semanticSimilarity: number,
  proofMethodMatch: number,
  domainMatch: number,
  queryText: string,
): number {
  if (!queryText.trim()) return 0;
  const typePrior: Record<ProofEntryType, number> = {
    theorem: 1,
    lemma: 0.75,
    proposition: 0.85,
    corollary: 0.65,
    proof: 0.55,
  };
  const prerequisiteSignal = entry.prerequisites.length > 0 ? 0.1 : 0;
  return Math.min(
    1,
    typePrior[entry.type] * 0.15 +
      keywordMatch * 0.25 +
      semanticSimilarity * 0.35 +
      proofMethodMatch * 0.15 +
      domainMatch * 0.10 +
      prerequisiteSignal,
  );
}

export function rankKnowledgeReferences(kb: KnowledgeBase, theorem: string, assumptions: string, keywords: string): RankedReference[] {
  const weights = kb.settings.weight_formula;
  const queryText = `${theorem} ${assumptions} ${keywords}`;
  const queryTokens = tokenize(queryText);
  const queryBigrams = bigrams(queryTokens);
  const allQueryTokens = [...queryTokens, ...queryBigrams];

  const corpus = kb.entries.map((e) => {
    const tokens = tokenize(`${e.statement} ${e.proofSummary} ${e.keywords.join(' ')} ${e.prerequisites.join(' ')}`);
    return [...tokens, ...bigrams(tokens)];
  });
  corpus.push(allQueryTokens);
  const idf = computeIdf(corpus);

  const topicFrequencyMap = new Map<string, number>();
  kb.papers.forEach((paper) => {
    paper.topics.forEach((topic) => topicFrequencyMap.set(topic.topicId, topic.frequency));
  });
  const maxTopicFrequency = Math.max(1, ...Array.from(topicFrequencyMap.values()));

  const scored = kb.entries.map((entry) => {
    const topTopicFreq = Math.max(0, ...entry.topics.map((topicId) => topicFrequencyMap.get(topicId) || 0));
    const topicFrequency = Math.min(1, topTopicFreq / maxTopicFrequency);
    const keywordMatch = scoreKeywordMatch(entry.keywords, queryTokens, idf);
    const semanticSimilarity = scoreSemanticSimilarity(entry, allQueryTokens, idf);
    const proofMethodMatch = scoreProofMethodMatch(entry.proofMethods ?? [], queryText);
    const domainMatch = scoreDomainMatch(entry.mathematicalDomain ?? '', queryText);
    const theoremImportance = scoreDynamicImportance(entry, keywordMatch, semanticSimilarity, proofMethodMatch, domainMatch, queryText);

    const score =
      topicFrequency * weights.topic_frequency +
      keywordMatch * weights.keyword_match +
      semanticSimilarity * weights.semantic_similarity +
      theoremImportance * weights.theorem_importance +
      proofMethodMatch * (weights.proof_method_match ?? 0) +
      domainMatch * (weights.domain_match ?? 0);

    return {
      entry,
      score,
      scoreBreakdown: {
        topicFrequency,
        keywordMatch,
        semanticSimilarity,
        theoremImportance,
        proofMethodMatch,
        domainMatch,
      },
      role: 'secondary' as const,
    };
  });

  const sorted = scored.sort((a, b) => b.score - a.score);
  const primaryCount = Math.max(1, kb.settings.top_k_primary);

  return sorted.slice(0, kb.settings.top_k_secondary).map((item, idx) => ({
    ...item,
    role: idx < primaryCount ? 'primary' : 'secondary',
  }));
}
