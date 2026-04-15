export type ProofEntryType = 'theorem' | 'proof';

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
  importance: number;
  citations: CitationRef[];
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
    schema_version: '1.0';
  };
  settings: {
    weight_formula: {
      topic_frequency: number;
      keyword_match: number;
      semantic_similarity: number;
      theorem_importance: number;
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
      version: '1.0.0',
      language: 'en',
      created_at: now,
      updated_at: now,
      schema_version: '1.0',
    },
    settings: {
      weight_formula: {
        topic_frequency: 0.35,
        keyword_match: 0.3,
        semantic_similarity: 0.25,
        theorem_importance: 0.1,
      },
      top_k_primary: 3,
      top_k_secondary: 10,
    },
    papers: [],
    entries: [],
  };
}

export function mergePaperIntoKnowledgeBase(kb: KnowledgeBase, payload: IngestedPaperPayload): KnowledgeBase {
  const nextPapers = [...kb.papers.filter((p) => p.paperId !== payload.paper.paperId), payload.paper];
  const nextEntries = [...kb.entries.filter((e) => e.paperId !== payload.paper.paperId), ...payload.entries];
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

function tokenize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function scoreKeywordMatch(entryKeywords: string[], queryTokens: string[]) {
  if (entryKeywords.length === 0 || queryTokens.length === 0) return 0;
  const entrySet = new Set(entryKeywords.map((x) => x.toLowerCase()));
  let hit = 0;
  queryTokens.forEach((token) => {
    if (entrySet.has(token)) hit += 1;
  });
  return Math.min(1, hit / Math.max(1, Math.min(queryTokens.length, 8)));
}

function scoreSemanticSimilarity(entry: KnowledgeEntry, queryTokens: string[]) {
  if (queryTokens.length === 0) return 0;
  const contentTokens = tokenize(`${entry.statement} ${entry.proofSummary}`);
  const contentSet = new Set(contentTokens);
  let hit = 0;
  queryTokens.forEach((token) => {
    if (contentSet.has(token)) hit += 1;
  });
  return Math.min(1, hit / Math.max(1, Math.min(queryTokens.length, 10)));
}

export function rankKnowledgeReferences(kb: KnowledgeBase, theorem: string, assumptions: string, keywords: string): RankedReference[] {
  const weights = kb.settings.weight_formula;
  const queryTokens = tokenize(`${theorem} ${assumptions} ${keywords}`);

  const topicFrequencyMap = new Map<string, number>();
  kb.papers.forEach((paper) => {
    paper.topics.forEach((topic) => topicFrequencyMap.set(topic.topicId, topic.frequency));
  });
  const maxTopicFrequency = Math.max(1, ...Array.from(topicFrequencyMap.values()));

  const scored = kb.entries.map((entry) => {
    const topTopicFreq = Math.max(0, ...entry.topics.map((topicId) => topicFrequencyMap.get(topicId) || 0));
    const topicFrequency = Math.min(1, topTopicFreq / maxTopicFrequency);
    const keywordMatch = scoreKeywordMatch(entry.keywords, queryTokens);
    const semanticSimilarity = scoreSemanticSimilarity(entry, queryTokens);
    const theoremImportance = Math.min(1, Math.max(0, entry.importance || 0));

    const score =
      topicFrequency * weights.topic_frequency +
      keywordMatch * weights.keyword_match +
      semanticSimilarity * weights.semantic_similarity +
      theoremImportance * weights.theorem_importance;

    return {
      entry,
      score,
      scoreBreakdown: {
        topicFrequency,
        keywordMatch,
        semanticSimilarity,
        theoremImportance,
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
