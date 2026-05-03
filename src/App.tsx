/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Play,
  Search,
  Edit3,
  BookOpen,
  CheckCircle2,
  RefreshCw,
  Terminal,
  FileText,
  Copy,
  Download,
  Zap,
  Database,
  ExternalLink,
  Check,
  Lightbulb,
  Upload,
  Plus,
  Square,
  CheckSquare,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { createEmptyKnowledgeBase, mergePaperIntoKnowledgeBase, migrateKnowledgeBase, rankKnowledgeReferences, type KnowledgeBase, type RankedReference } from './kb';

interface LogEntry {
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

interface LiteratureMatch {
  title: string;
  authors: string;
  source: string;
  score: number;
  tags: string[];
  url?: string;
}

interface GenerateProofResponse {
  proof: string;
}

interface ApiAttemptReport {
  model?: string;
  promptType?: 'full' | 'compact';
  status?: 'ok' | 'empty' | 'error';
  detail?: string;
}

interface ApiErrorPayload {
  error?: string;
  errorCode?: string;
  userHint?: string;
  summary?: string;
  attempts?: ApiAttemptReport[];
}

type VerifierDecision = 'PASS' | 'MINOR_FIX' | 'REGENERATE';

interface VerifyProofResponse {
  decision: VerifierDecision;
  feedback: string;
  riskLevel?: 'low' | 'medium' | 'high';
}

interface ReviseProofResponse {
  revisedProof: string;
}

interface GenerateIdeasResponse {
  ideas: string[];
  candidateTheorems: CandidateTheorem[];
}

interface CandidateTheorem {
  name: string;
  why: string;
}

type ModelProvider = 'gemini' | 'deepseek';

interface ModelOption {
  id: string;
  label: string;
  provider: ModelProvider;
  apiPath: string;
  ideasApiPath: string;
}

const MODEL_OPTIONS: ModelOption[] = [
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', provider: 'deepseek', apiPath: '/api/generate-proof-deepseek', ideasApiPath: '/api/generate-ideas-deepseek' },
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', provider: 'deepseek', apiPath: '/api/generate-proof-deepseek', ideasApiPath: '/api/generate-ideas-deepseek' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'gemini', apiPath: '/api/generate-proof', ideasApiPath: '/api/generate-ideas' },
];

declare global {
  interface Window {
    MathJax?: {
      typesetPromise?: (elements?: HTMLElement[]) => Promise<void>;
      startup?: {
        promise?: Promise<void>;
      };
    };
  }
}

function compactKnowledgeRefs(refs: RankedReference[]) {
  return refs.map((r) => ({
    label: r.entry.label,
    statement: r.entry.statement,
    proofSummary: r.entry.proofSummary,
    proofMethods: r.entry.proofMethods,
    prerequisites: r.entry.prerequisites,
    domain: r.entry.mathematicalDomain,
    role: r.role,
  }));
}

function litMatchKey(m: LiteratureMatch): string {
  return `${m.title}|||${m.source}`;
}

function buildLiteratureBrief(matches: LiteratureMatch[]): string {
  const top = [...matches].sort((a, b) => b.score - a.score).slice(0, 3);
  if (top.length === 0) return '';
  return top.map((m, i) =>
    `${i + 1}. "${m.title}" (${m.source}, score=${m.score.toFixed(2)}) — ${m.tags.filter(t => t !== 'arXiv' && t !== 'Crossref' && t !== 'Metadata' && t !== 'Open Access').join(', ') || 'general reference'}`
  ).join('\n');
}

function buildPipelineErrorMessage(stage: string, rawError: string) {
  const stageMap: Record<string, string> = {
    initialization: 'initialization',
    'idea brainstorming': 'idea brainstorming',
    'candidate proof generation': 'candidate proof generation',
    'proof verification': 'proof verification',
    'proof revision': 'proof revision',
  };
  const displayStage = stageMap[stage] || stage;
  if (/failed to fetch|networkerror|load failed/i.test(rawError)) {
    return `Pipeline failed during ${displayStage}: Unable to reach the API service. Please retry.`;
  }
  if (/timed out|timeout/i.test(rawError)) {
    return `Pipeline failed during ${displayStage}: The API request timed out.`;
  }
  return `Pipeline failed during ${displayStage}: ${rawError}`;
}

function isNetworkFetchError(error: unknown) {
  return error instanceof TypeError && /failed to fetch|networkerror|load failed/i.test(error.message);
}

function isAbortTimeoutError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

function normalizeForMathJax(content: string) {
  return content
    .replace(/```latex\n?/g, '').replace(/```\n?/g, '')
    .replace(/\\documentclass\{[^}]+\}/g, '').replace(/\\usepackage\{[^}]+\}/g, '')
    .replace(/\\begin\{document\}/g, '').replace(/\\end\{document\}/g, '')
    .replace(/^\s*#+\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1').replace(/__(.*?)__/g, '$1')
    .trim();
}

export default function App() {
  const [theorem, setTheorem] = useState('');
  const [assumptions, setAssumptions] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([
    { timestamp: '09:42:12', message: 'System initialized. Ready for input.', type: 'info' },
  ]);
  const [proof, setProof] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'formatted' | 'source'>('formatted');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState('deepseek-v4-pro');
  const [possibleIdeas, setPossibleIdeas] = useState<string[]>([]);
  const [candidateTheorems, setCandidateTheorems] = useState<CandidateTheorem[]>([]);

  // Literature state
  const [litQuery, setLitQuery] = useState('');
  const [litSearchResults, setLitSearchResults] = useState<LiteratureMatch[]>([]);
  const [isSearchingLit, setIsSearchingLit] = useState(false);
  const [selectedLitKeys, setSelectedLitKeys] = useState<Set<string>>(new Set());
  const [pinnedLitMatches, setPinnedLitMatches] = useState<LiteratureMatch[]>([]);
  const [isAddingToKb, setIsAddingToKb] = useState(false);

  const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeBase>(() => createEmptyKnowledgeBase());
  const [isIngestingPaper, setIsIngestingPaper] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  const logEndRef = useRef<HTMLDivElement>(null);
  const proofRef = useRef<HTMLDivElement>(null);
  const ideasRef = useRef<HTMLDivElement>(null);

  const resolveModelOption = (modelId: string) =>
    MODEL_OPTIONS.find((option) => option.id === modelId) || MODEL_OPTIONS[0];

  const allSelectedMatches = useMemo(() => {
    const byKey = new Map<string, LiteratureMatch>();
    for (const m of pinnedLitMatches) byKey.set(litMatchKey(m), m);
    for (const m of litSearchResults) {
      const k = litMatchKey(m);
      if (selectedLitKeys.has(k) && !byKey.has(k)) byKey.set(k, m);
    }
    return [...byKey.values()];
  }, [pinnedLitMatches, litSearchResults, selectedLitKeys]);

  const rankedKnowledgeReferences = useMemo<RankedReference[]>(
    () => rankKnowledgeReferences(knowledgeBase, theorem, assumptions, ''),
    [knowledgeBase, theorem, assumptions],
  );

  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info') => {
    const now = new Date();
    const timestamp = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    setLogs((prev) => [...prev, { timestamp, message, type }]);
  }, []);

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  useEffect(() => {
    if (document.getElementById('mathjax-script')) return;
    const script = document.createElement('script');
    script.id = 'mathjax-script';
    script.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js';
    script.async = true;
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    if (!window.MathJax?.typesetPromise) return;
    const elements: HTMLElement[] = [];
    if (proof && activeTab === 'formatted' && proofRef.current) elements.push(proofRef.current);
    if ((possibleIdeas.length > 0 || candidateTheorems.length > 0) && ideasRef.current) elements.push(ideasRef.current);
    if (elements.length === 0) return;
    window.MathJax.typesetPromise(elements).catch((err) => console.error(err));
  }, [proof, activeTab, possibleIdeas, candidateTheorems]);

  // Literature: debounced real-time search
  useEffect(() => {
    const q = litQuery.trim();
    if (!q || q.length < 3) {
      setLitSearchResults([]);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setIsSearchingLit(true);
      try {
        const response = await fetch('/api/literature-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ theorem: q, assumptions: '', researchField: '', keywords: '' }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('search failed');
        const data = await response.json();
        const matches: LiteratureMatch[] = Array.isArray(data?.literature) ? data.literature.slice(0, 8) : [];
        setLitSearchResults(matches);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setLitSearchResults([]);
      } finally {
        setIsSearchingLit(false);
      }
    }, 500);

    return () => { window.clearTimeout(timeoutId); controller.abort(); };
  }, [litQuery]);

  const toggleLitSelection = (match: LiteratureMatch) => {
    const key = litMatchKey(match);
    setSelectedLitKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        setPinnedLitMatches((p) => p.filter((m) => litMatchKey(m) !== key));
      } else {
        next.add(key);
        setPinnedLitMatches((p) => {
          if (p.some((m) => litMatchKey(m) === key)) return p;
          return [...p, match];
        });
      }
      return next;
    });
  };

  const handleAddSelectedToKb = async () => {
    if (allSelectedMatches.length === 0 || isAddingToKb) return;
    setIsAddingToKb(true);
    addLog(`Adding ${allSelectedMatches.length} literature paper(s) to knowledge base...`, 'info');
    try {
      for (const match of allSelectedMatches) {
        const paperId = `lit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const payload = {
          paper: {
            paperId,
            title: match.title,
            sourceFile: match.url || 'literature-search',
            keywords: match.tags.filter((t) => t !== 'arXiv' && t !== 'Crossref' && t !== 'Metadata' && t !== 'Open Access'),
            topics: [{
              topicId: `${paperId}_topic_1`,
              name: match.tags[0] || 'General',
              keywords: match.tags,
              frequency: 1,
              weight: match.score,
            }],
            uploadedAt: new Date().toISOString(),
          },
          entries: [{
            entryId: `${paperId}_ref_1`,
            paperId,
            type: 'theorem' as const,
            label: match.title,
            statement: `${match.title} — ${match.authors}`,
            proofSummary: `Reference from ${match.source}. Score: ${match.score.toFixed(2)}.`,
            keywords: match.tags,
            topics: [`${paperId}_topic_1`],
            importance: match.score,
            citations: [{
              paperId,
              paperTitle: match.title,
              pageStart: 0,
              pageEnd: 0,
            }],
            proofMethods: [] as import('./kb').ProofMethod[],
            prerequisites: [] as string[],
            mathematicalDomain: '',
          }],
        };
        setKnowledgeBase((prev) => mergePaperIntoKnowledgeBase(prev, payload));
        addLog(`Added "${match.title}" to KB.`, 'success');
      }
      setSelectedLitKeys(new Set());
      setPinnedLitMatches([]);
    } catch (error) {
      addLog(`Failed to add papers to KB: ${error instanceof Error ? error.message : 'unknown error'}`, 'error');
    } finally {
      setIsAddingToKb(false);
    }
  };

  const handlePaperUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsIngestingPaper(true);
    try {
      const fileList = Array.from(files).filter((file) => file.name.toLowerCase().endsWith('.pdf'));
      for (const file of fileList) {
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
        const fileDataBase64 = btoa(binary);
        const response = await fetch('/api/ingest-paper', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: file.name, fileDataBase64 }),
        });
        if (!response.ok) throw new Error(`Ingest failed for ${file.name}`);
        const payload = await response.json();
        setKnowledgeBase((prev) => mergePaperIntoKnowledgeBase(prev, payload));
        addLog(`Knowledge base updated from ${file.name}.`, 'success');
      }
    } catch (error) {
      addLog(`Paper ingestion failed: ${error instanceof Error ? error.message : 'unknown error'}`, 'error');
    } finally {
      setIsIngestingPaper(false);
    }
  };

  const handleExportKnowledgeBase = () => {
    const blob = new Blob([JSON.stringify(knowledgeBase, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${knowledgeBase.kb_meta.name.replace(/\s+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addLog('Knowledge base exported.', 'success');
  };

  const handleImportKnowledgeBase = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      if (!payload?.kb_meta || !Array.isArray(payload?.papers) || !Array.isArray(payload?.entries)) {
        throw new Error('Invalid knowledge base schema.');
      }
      setKnowledgeBase(migrateKnowledgeBase(payload));
      addLog(`Knowledge base imported (${payload.papers.length} papers).`, 'success');
    } catch (error) {
      addLog(`Knowledge base import failed: ${error instanceof Error ? error.message : 'unknown error'}`, 'error');
    }
  };

  // Generate Proof pipeline (independent, no literature search step)
  const handleGenerate = async () => {
    if (isGenerating) return;

    const modelOption = resolveModelOption(selectedModelId);
    setIsGenerating(true);
    setProof(null);
    setErrorMessage(null);
    setPossibleIdeas([]);
    setCandidateTheorems([]);
    setProgress(0);
    addLog(`Pipeline started with ${modelOption.label}.`, 'info');

    const verifyApiPath = modelOption.provider === 'gemini' ? '/api/verify-proof' : '/api/verify-proof-deepseek';
    const reviseApiPath = modelOption.provider === 'gemini' ? '/api/revise-proof' : '/api/revise-proof-deepseek';
    const maxMinorFixRounds = 3;
    const maxRegenerateRounds = 2;
    let pipelineStage = 'initialization';

    const literatureBrief = buildLiteratureBrief(allSelectedMatches);

    const appendRiskSummary = (baseProof: string, riskNotes: string[]) => {
      if (riskNotes.length === 0) return baseProof;
      return `${baseProof}\n\n---\n\nRisk Notes:\n${riskNotes.map((note, index) => `${index + 1}. ${note}`).join('\n')}`;
    };

    const parseApiError = (body: ApiErrorPayload, fallback: string, status?: number, statusText?: string, rawText?: string) => {
      const headline = body.error || fallback;
      const code = body.errorCode ? ` [${body.errorCode}]` : '';
      const hint = body.userHint ? ` Hint: ${body.userHint}` : '';
      const summary = body.summary ? ` Details: ${body.summary}` : '';
      const attempts = Array.isArray(body.attempts) ? body.attempts.slice(0, 4).map((a, i) => `${i + 1}) ${a.model || '?'}/${a.promptType || '?'}: ${a.detail || a.status || '?'}`).join('; ') : '';
      const attemptText = attempts ? ` Attempts: ${attempts}` : '';
      const http = typeof status === 'number' ? ` HTTP ${status}${statusText ? ` ${statusText}` : ''}.` : '';
      const raw = !body.error && rawText ? ` Raw: ${rawText.slice(0, 280)}` : '';
      return `${headline}${code}.${http}${hint}${summary}${attemptText}${raw}`.trim();
    };

    const requestJsonWithRetry = async <T,>(params: {
      stage: string; endpoint: string; body: Record<string, unknown>; fallbackError: string;
      maxRetries?: number; retryOnHttp?: boolean; requestTimeoutMs?: number;
    }) => {
      const { stage, endpoint, body, fallbackError, maxRetries = 1, retryOnHttp = true, requestTimeoutMs = 80000 } = params;
      pipelineStage = stage;
      let response: Response | null = null;
      let rawText = '';
      let parsedBody: unknown = {};
      let lastError: unknown = null;

      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        let timeoutId: number | null = null;
        try {
          const controller = new AbortController();
          timeoutId = window.setTimeout(() => controller.abort(), requestTimeoutMs);
          response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
          rawText = await response.text();
          try { parsedBody = rawText ? JSON.parse(rawText) : {}; } catch { parsedBody = {}; }
          if (!response.ok) {
            const canRetry = retryOnHttp && (response.status >= 500 || response.status === 429 || response.status === 408);
            if (canRetry && attempt < maxRetries) { addLog(`${stage} API returned ${response.status}, retrying...`, 'warning'); await new Promise((r) => setTimeout(r, 1000 * (attempt + 1))); continue; }
            throw new Error(parseApiError(parsedBody as ApiErrorPayload, fallbackError, response.status, response.statusText, rawText));
          }
          return parsedBody as T;
        } catch (error) {
          lastError = error;
          const retryable = isNetworkFetchError(error) || isAbortTimeoutError(error);
          if (!retryable || attempt >= maxRetries) {
            if (isAbortTimeoutError(error)) throw new Error(`Request timed out after ${Math.round(requestTimeoutMs / 1000)}s.`);
            throw error;
          }
          addLog(`${stage} API temporarily unreachable, retrying...`, 'warning');
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        } finally {
          if (timeoutId !== null) window.clearTimeout(timeoutId);
        }
      }
      throw new Error(lastError instanceof Error ? lastError.message : fallbackError);
    };

    try {
      // Step 1: Idea brainstorming
      setProgress(1);
      try {
        const ideasData = await requestJsonWithRetry<GenerateIdeasResponse>({
          stage: 'idea brainstorming', endpoint: modelOption.ideasApiPath,
          body: { theorem, assumptions, literatureBrief, knowledgeReferences: compactKnowledgeRefs(rankedKnowledgeReferences), model: modelOption.id },
          fallbackError: 'Idea generation failed.', maxRetries: 1, retryOnHttp: true,
          requestTimeoutMs: modelOption.provider === 'deepseek' ? 70000 : 50000,
        });
        setPossibleIdeas(Array.isArray(ideasData.ideas) ? ideasData.ideas : []);
        setCandidateTheorems(Array.isArray(ideasData.candidateTheorems) ? ideasData.candidateTheorems : []);
        addLog('Brainstormed proof ideas and candidate theorems.', 'success');
      } catch { addLog('Idea generation failed, continuing.', 'warning'); }

      const fetchProof = async () => {
        const d = await requestJsonWithRetry<GenerateProofResponse>({
          stage: 'candidate proof generation', endpoint: modelOption.apiPath,
          body: { theorem, assumptions, literatureBrief, knowledgeReferences: compactKnowledgeRefs(rankedKnowledgeReferences), model: modelOption.id },
          fallbackError: 'Failed to generate proof.', maxRetries: 1, retryOnHttp: true,
          requestTimeoutMs: modelOption.provider === 'deepseek' ? 90000 : 70000,
        });
        const c = typeof d.proof === 'string' ? d.proof.trim() : '';
        if (!c) throw new Error('Generator returned an empty proof.');
        return c;
      };
      const verifyProof = async (cp: string) => requestJsonWithRetry<VerifyProofResponse>({
        stage: 'proof verification', endpoint: verifyApiPath,
        body: { theorem, assumptions, proof: cp, model: modelOption.id },
        fallbackError: 'Proof verification failed.', maxRetries: 1, retryOnHttp: true,
      });
      const reviseProof = async (cp: string, fb: string) => {
        const d = await requestJsonWithRetry<ReviseProofResponse>({
          stage: 'proof revision', endpoint: reviseApiPath,
          body: { theorem, assumptions, proof: cp, feedback: fb, model: modelOption.id },
          fallbackError: 'Proof revision failed.', maxRetries: 1, retryOnHttp: true,
        });
        return d.revisedProof || cp;
      };

      let bestProof = '';
      const riskNotes: string[] = [];
      let finalProof = '';
      let completed = false;

      for (let rr = 0; rr <= maxRegenerateRounds && !completed; rr += 1) {
        setProgress(2);
        addLog(`Generator pass ${rr + 1}: drafting candidate proof...`, 'info');
        let candidateProof = await fetchProof();
        bestProof = candidateProof;

        for (let mf = 0; mf <= maxMinorFixRounds; mf += 1) {
          setProgress(3);
          addLog(`Verifier review ${mf + 1}: checking logical soundness.`, 'info');
          const vd = await verifyProof(candidateProof);
          if (vd.decision === 'PASS') {
            setProgress(5); completed = true;
            finalProof = appendRiskSummary(candidateProof, riskNotes);
            addLog('Verifier accepted proof. Pipeline completed.', 'success');
            break;
          }
          if (vd.decision === 'MINOR_FIX') {
            if (mf >= maxMinorFixRounds) { riskNotes.push(`Minor-fix budget reached. ${vd.feedback}`); addLog('Minor-fix limit reached.', 'warning'); break; }
            setProgress(4);
            addLog(`Verifier requested revision: ${vd.feedback}`, 'warning');
            candidateProof = await reviseProof(candidateProof, vd.feedback);
            bestProof = candidateProof;
            addLog(`Reviser completed patch ${mf + 1}.`, 'success');
            continue;
          }
          riskNotes.push(`Critical flaw: ${vd.feedback}`);
          addLog(`Verifier: critically flawed: ${vd.feedback}`, 'error');
          break;
        }
      }

      if (!completed) {
        finalProof = appendRiskSummary(bestProof || 'No reliable proof could be generated.', [
          ...riskNotes, 'Reached iteration limits. Best available draft requires manual verification.',
        ]);
        addLog('Pipeline stopped at limits. Returned best draft.', 'warning');
        setProgress(5);
      }

      setProof(finalProof);
      addLog(`Proof pipeline finished via ${modelOption.label}.`, completed ? 'success' : 'warning');
    } catch (error: unknown) {
      console.error(error);
      const rawError = error instanceof Error ? error.message : 'Unknown server error.';
      setErrorMessage(buildPipelineErrorMessage(pipelineStage, rawError));
      addLog(`Pipeline error at ${pipelineStage}: ${rawError}`, 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  // KB Generate: independent, uses the global model selection
  const handleKbGenerate = async () => {
    if (isGenerating) return;
    const modelOption = resolveModelOption(selectedModelId);
    setIsGenerating(true);
    setProof(null);
    setErrorMessage(null);
    setPossibleIdeas([]);
    setCandidateTheorems([]);
    setProgress(0);
    addLog(`KB Generate started with ${modelOption.label}.`, 'info');

    const literatureBrief = buildLiteratureBrief(allSelectedMatches);

    try {
      setProgress(1);
      try {
        const response = await fetch(modelOption.ideasApiPath, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ theorem, assumptions, literatureBrief, knowledgeReferences: compactKnowledgeRefs(rankedKnowledgeReferences), model: modelOption.id }),
        });
        if (response.ok) {
          const data = await response.json();
          setPossibleIdeas(Array.isArray(data.ideas) ? data.ideas : []);
          setCandidateTheorems(Array.isArray(data.candidateTheorems) ? data.candidateTheorems : []);
          addLog('KB brainstormed proof ideas.', 'success');
        }
      } catch { addLog('KB idea generation failed.', 'warning'); }

      setProgress(2);
      const response = await fetch(modelOption.apiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theorem, assumptions, literatureBrief, knowledgeReferences: compactKnowledgeRefs(rankedKnowledgeReferences), model: modelOption.id }),
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`KB proof generation failed: HTTP ${response.status}. ${errText.slice(0, 200)}`);
      }
      const data = await response.json();
      const proofText = typeof data.proof === 'string' ? data.proof.trim() : '';
      if (proofText) {
        setProof(proofText);
        addLog(`KB proof generated via ${modelOption.label}.`, 'success');
      } else {
        throw new Error('KB generator returned empty proof.');
      }
      setProgress(5);
    } catch (error: unknown) {
      console.error(error);
      const rawError = error instanceof Error ? error.message : 'Unknown error.';
      setErrorMessage(rawError);
      addLog(`KB Generate error: ${rawError}`, 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const PIPELINE_STEPS = [
    { id: 1, name: 'Ideas', icon: Lightbulb },
    { id: 2, name: 'Generate', icon: Edit3 },
    { id: 3, name: 'Verify', icon: CheckCircle2 },
    { id: 4, name: 'Revise', icon: RefreshCw },
    { id: 5, name: 'Done', icon: Check },
  ];

  const displayResults = useMemo(() => {
    const pinnedKeys = new Set(pinnedLitMatches.map(litMatchKey));
    const unpinnedResults = litSearchResults.filter((m) => !pinnedKeys.has(litMatchKey(m)));
    return [...pinnedLitMatches, ...unpinnedResults];
  }, [pinnedLitMatches, litSearchResults]);

  return (
    <div className="min-h-screen flex flex-col font-sans bg-slate-50">
      <header className="h-16 border-b border-slate-200 bg-white sticky top-0 z-50 px-6 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-[#064e3b] rounded-lg flex items-center justify-center text-white shadow-sm">
            <Zap size={20} fill="white" />
          </div>
          <h1 className="text-lg font-bold text-slate-900 tracking-tight">Proof Assistant</h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 border border-emerald-100 rounded-full">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] font-bold text-emerald-700 uppercase">Ready</span>
          </div>
          <select value={selectedModelId} onChange={(e) => setSelectedModelId(e.target.value)}
            className="text-sm font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5" disabled={isGenerating}>
            {MODEL_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <button onClick={handleGenerate} disabled={isGenerating}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg font-bold text-sm transition-all shadow-sm ${isGenerating ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-[#064e3b] text-white hover:bg-[#065f46] active:scale-[0.97]'}`}>
            {isGenerating ? <RefreshCw size={16} className="animate-spin" /> : <Play size={16} fill="currentColor" />}
            {isGenerating ? 'Generating...' : 'Generate Proof'}
          </button>
        </div>
      </header>

      {/* Pipeline progress bar */}
      <div className="bg-white border-b border-slate-200 px-6 py-2.5">
        <div className="max-w-[1600px] mx-auto flex items-center gap-1">
          {PIPELINE_STEPS.map((step, idx) => {
            const Icon = step.icon;
            const isActive = progress === step.id;
            const isDone = progress > step.id;
            return (
              <div key={step.id} className="flex items-center">
                {idx > 0 && <div className={`w-8 h-px mx-1 ${isDone ? 'bg-emerald-400' : 'bg-slate-200'}`} />}
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${isDone ? 'bg-emerald-50 text-emerald-700' : isActive ? 'bg-[#064e3b] text-white' : 'text-slate-400'}`}>
                  {isDone ? <Check size={12} /> : <Icon size={12} />}
                  <span className="hidden sm:inline">{step.name}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <main className="flex-1 max-w-[1600px] mx-auto w-full p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 overflow-hidden">
        {/* Left column */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          {/* Workspace */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <h2 className="font-bold text-slate-900 flex items-center gap-2 mb-4 text-sm">
              <Edit3 size={16} className="text-[#064e3b]" /> Workspace
            </h2>
            <div className="space-y-4">
              {errorMessage && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{errorMessage}</div>}
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 block">Theorem Statement</label>
                <textarea value={theorem} onChange={(e) => setTheorem(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3.5 text-sm focus:ring-2 focus:ring-[#064e3b]/10 focus:border-[#064e3b] transition-all min-h-[120px] resize-none leading-relaxed text-slate-700" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 block">Known Assumptions</label>
                <textarea value={assumptions} onChange={(e) => setAssumptions(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3.5 text-sm focus:ring-2 focus:ring-[#064e3b]/10 focus:border-[#064e3b] transition-all min-h-[100px] resize-none leading-relaxed text-slate-700" />
              </div>
            </div>
          </section>

          {/* Knowledge Base */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-slate-900 flex items-center gap-2 text-sm">
                <Database size={16} className="text-[#064e3b]" /> Knowledge Base
              </h2>
              <span className="text-[10px] px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full font-bold border border-emerald-100">
                {knowledgeBase.papers.length} PAPERS / {knowledgeBase.entries.length} ENTRIES
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <label className="flex items-center justify-center gap-1.5 text-[11px] font-bold border border-slate-200 rounded-lg px-2 py-1.5 cursor-pointer hover:border-[#064e3b]/40 transition-colors">
                <Upload size={12} /> {isIngestingPaper ? 'Processing...' : 'Upload PDF'}
                <input type="file" accept="application/pdf" multiple className="hidden" onChange={(e) => handlePaperUpload(e.target.files)} disabled={isIngestingPaper} />
              </label>
              <label className="flex items-center justify-center gap-1.5 text-[11px] font-bold border border-slate-200 rounded-lg px-2 py-1.5 cursor-pointer hover:border-[#064e3b]/40 transition-colors">
                <FileText size={12} /> Import
                <input type="file" accept="application/json" className="hidden" onChange={(e) => handleImportKnowledgeBase(e.target.files?.[0] || null)} />
              </label>
              <button onClick={handleExportKnowledgeBase} className="flex items-center justify-center gap-1.5 text-[11px] font-bold border border-slate-200 rounded-lg px-2 py-1.5 hover:border-[#064e3b]/40 transition-colors">
                <Download size={12} /> Export
              </button>
            </div>
            <button onClick={handleKbGenerate} disabled={isGenerating}
              className={`flex items-center justify-center gap-1.5 text-[11px] font-bold rounded-lg px-3 py-2 mb-3 w-full transition-all ${isGenerating ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-[#064e3b] text-white hover:bg-[#065f46]'}`}>
              {isGenerating ? <RefreshCw size={12} className="animate-spin" /> : <Database size={12} />}
              Generate (KB)
            </button>
            <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
              {rankedKnowledgeReferences.slice(0, 5).map((ref) => (
                <div key={ref.entry.entryId} className={`rounded-md border px-2.5 py-1.5 ${ref.role === 'primary' ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-700">{ref.entry.label}</span>
                    <span className="text-[10px] font-mono text-slate-500">w={ref.score.toFixed(2)} • {ref.role}</span>
                  </div>
                  <p className="text-[10px] text-slate-500 line-clamp-1">{ref.entry.statement || ref.entry.proofSummary}</p>
                  {ref.entry.proofMethods && ref.entry.proofMethods.length > 0 && (
                    <div className="flex gap-1 mt-1">
                      {ref.entry.proofMethods.map((m) => <span key={m} className="text-[9px] px-1 py-0.5 bg-slate-100 text-slate-500 rounded font-bold">{m}</span>)}
                    </div>
                  )}
                </div>
              ))}
              {rankedKnowledgeReferences.length === 0 && <p className="text-[11px] text-slate-400">Upload PDFs or import a KB JSON to enable weighted references.</p>}
            </div>
          </section>

          {/* Literature Search */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-slate-900 flex items-center gap-2 text-sm">
                <BookOpen size={16} className="text-[#064e3b]" /> Literature
              </h2>
              <div className="flex items-center gap-2">
                {selectedLitKeys.size > 0 && (
                  <span className="text-[10px] px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full font-bold border border-blue-100">
                    {selectedLitKeys.size} SELECTED
                  </span>
                )}
                <span className="text-[10px] px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full font-bold border border-emerald-100">
                  {isSearchingLit ? 'SEARCHING…' : `${litSearchResults.length} RESULTS`}
                </span>
              </div>
            </div>

            <div className="relative mb-3">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={litQuery}
                onChange={(e) => setLitQuery(e.target.value)}
                placeholder="Search papers (e.g. Hoeffding inequality, martingale convergence)..."
                className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 pl-9 pr-3 text-sm text-slate-700"
              />
            </div>

            {selectedLitKeys.size > 0 && (
              <button onClick={handleAddSelectedToKb} disabled={isAddingToKb}
                className={`flex items-center justify-center gap-1.5 text-[11px] font-bold rounded-lg px-3 py-2 mb-3 w-full transition-all ${isAddingToKb ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-[#064e3b] text-white hover:bg-[#065f46]'}`}>
                {isAddingToKb ? <RefreshCw size={12} className="animate-spin" /> : <Plus size={12} />}
                {isAddingToKb ? 'Adding...' : `Add ${selectedLitKeys.size} paper(s) to Knowledge Base`}
              </button>
            )}

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {displayResults.map((match, idx) => {
                const key = litMatchKey(match);
                const isSelected = selectedLitKeys.has(key);
                return (
                  <motion.div
                    key={key}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.03 }}
                    className={`p-3 rounded-lg border transition-colors cursor-pointer ${isSelected ? 'border-emerald-300 bg-emerald-50/60' : 'border-slate-100 hover:border-[#064e3b]/30 hover:bg-slate-50/50'}`}
                    onClick={() => toggleLitSelection(match)}
                  >
                    <div className="flex items-start gap-2">
                      <div className="mt-0.5 shrink-0">
                        {isSelected
                          ? <CheckSquare size={16} className="text-emerald-600" />
                          : <Square size={16} className="text-slate-300" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start mb-1">
                          <h3 className="text-xs font-bold text-slate-900 leading-snug flex-1 mr-2">{match.title}</h3>
                          <span className="text-[10px] font-mono font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100 shrink-0">{match.score.toFixed(2)}</span>
                        </div>
                        <p className="text-[10px] text-slate-500 mb-1">{match.authors} • {match.source}</p>
                        <div className="flex items-center gap-2">
                          {match.url && (
                            <a href={match.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-0.5 text-[10px] text-emerald-700 hover:text-emerald-800">
                              View <ExternalLink size={10} />
                            </a>
                          )}
                          {match.tags.slice(0, 3).map((tag) => (
                            <span key={tag} className="text-[9px] px-1 py-0.5 bg-slate-100 text-slate-500 rounded font-bold uppercase">{tag}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
              {displayResults.length === 0 && !isSearchingLit && (
                <p className="text-[11px] text-slate-400 py-2">Type a search query above to find papers from arXiv and Crossref.</p>
              )}
              {isSearchingLit && (
                <div className="flex items-center gap-2 py-4 justify-center text-slate-400">
                  <RefreshCw size={14} className="animate-spin" />
                  <span className="text-xs">Searching...</span>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Right column */}
        <div className="lg:col-span-8 flex flex-col gap-6 overflow-hidden">
          {/* Proof Output */}
          <section className="bg-white border border-slate-200 rounded-xl flex-1 flex flex-col shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <h2 className="font-bold text-slate-900 flex items-center gap-2 text-sm"><FileText size={16} className="text-[#064e3b]" /> Proof Output</h2>
              <div className="flex bg-white border border-slate-200 rounded-lg p-0.5">
                <button onClick={() => setActiveTab('source')} className={`px-3 py-1 text-xs font-bold rounded transition-all ${activeTab === 'source' ? 'bg-slate-100 text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}>Source</button>
                <button onClick={() => setActiveTab('formatted')} className={`px-3 py-1 text-xs font-bold rounded transition-all ${activeTab === 'formatted' ? 'bg-[#064e3b] text-white shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>Compiled</button>
              </div>
            </div>
            <div className="flex-1 p-6 overflow-y-auto bg-white">
              <AnimatePresence mode="wait">
                {!proof ? (
                  <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full flex flex-col items-center justify-center text-slate-300 gap-3">
                    <FileText size={48} strokeWidth={1} />
                    <p className="text-sm font-medium">No proof generated yet.</p>
                    <p className="text-xs text-slate-400">Enter a theorem statement and click Generate Proof.</p>
                  </motion.div>
                ) : (
                  <motion.article key="content" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="max-w-3xl mx-auto font-serif text-slate-800 leading-relaxed">
                    {activeTab === 'formatted' ? (
                      <div>
                        <div className="text-center mb-6">
                          <h3 className="text-lg font-bold text-slate-900 mb-0.5 font-serif">Compiled Mathematical Proof</h3>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] font-sans">MathJax Rendering</p>
                        </div>
                        <div ref={proofRef} className="whitespace-pre-wrap text-base leading-7 [&_.MathJax]:!text-slate-800">{normalizeForMathJax(proof)}</div>
                      </div>
                    ) : (
                      <pre className="font-mono text-xs bg-slate-50 p-5 rounded-lg border border-slate-200 overflow-x-auto">{proof}</pre>
                    )}
                  </motion.article>
                )}
              </AnimatePresence>
            </div>
            <div className="p-3 border-t border-slate-100 bg-white flex justify-between">
              <button className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-[#064e3b] transition-colors px-3 py-1.5"><Copy size={14} /> Copy LaTeX</button>
              <button className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-[#064e3b] transition-colors px-3 py-1.5"><Download size={14} /> Export PDF</button>
            </div>
          </section>

          {/* Ideas */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <h2 className="font-bold text-sm text-slate-900 mb-3 flex items-center gap-2">
              <Lightbulb size={16} className="text-[#064e3b]" /> Proof Ideas & Candidate Theorems
            </h2>
            {possibleIdeas.length === 0 && candidateTheorems.length === 0 ? (
              <div className="text-sm text-slate-400">
                {isGenerating ? 'AI is analyzing the workspace to propose proof ideas...' : 'Click Generate Proof to get AI-proposed proof strategies.'}
              </div>
            ) : (
              <div ref={ideasRef} className="[&_.MathJax]:!text-slate-700">
                <ul className="space-y-1.5 list-disc pl-4 text-sm text-slate-700 mb-3">
                  {possibleIdeas.map((idea) => <li key={idea} className="leading-relaxed whitespace-pre-wrap">{normalizeForMathJax(idea)}</li>)}
                </ul>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {candidateTheorems.map((ct) => (
                    <div key={ct.name} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                      <div className="text-xs font-bold text-slate-800 whitespace-pre-wrap [&_.MathJax]:!text-slate-800">{normalizeForMathJax(ct.name)}</div>
                      <div className="text-[11px] text-slate-500 whitespace-pre-wrap [&_.MathJax]:!text-slate-500">{normalizeForMathJax(ct.why)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Log */}
          <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <button onClick={() => setShowLogs(!showLogs)}
              className="w-full px-5 py-3 flex items-center justify-between text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors">
              <span className="flex items-center gap-2"><Terminal size={14} className="text-[#064e3b]" /> Execution Log</span>
              <span className="text-[10px] text-slate-400">{logs.length} entries • {showLogs ? 'collapse' : 'expand'}</span>
            </button>
            {showLogs && (
              <div className="border-t border-slate-100 bg-slate-900 p-4 font-mono text-[11px] max-h-52 overflow-y-auto leading-relaxed">
                {logs.map((log, idx) => (
                  <div key={idx} className="mb-0.5">
                    <span className="text-slate-500">[{log.timestamp}]</span>{' '}
                    <span className={log.type === 'success' ? 'text-emerald-400' : log.type === 'warning' ? 'text-amber-400' : log.type === 'error' ? 'text-rose-400' : 'text-slate-300'}>{log.message}</span>
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
