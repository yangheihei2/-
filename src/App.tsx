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

interface LiteratureKeywords {
  suggested: string;
  used: string;
  source: 'rule' | 'manual';
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
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'gemini', apiPath: '/api/generate-proof', ideasApiPath: '/api/generate-ideas' },
  { id: 'deepseek-chat', label: 'DeepSeek Chat', provider: 'deepseek', apiPath: '/api/generate-proof-deepseek', ideasApiPath: '/api/generate-ideas-deepseek' },
  { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner', provider: 'deepseek', apiPath: '/api/generate-proof-deepseek', ideasApiPath: '/api/generate-ideas-deepseek' },
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

function buildLiteratureBrief(matches: LiteratureMatch[]): string {
  const top = matches
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  if (top.length === 0) return '';
  return top.map((m, i) =>
    `${i + 1}. "${m.title}" (${m.source}, score=${m.score.toFixed(2)}) — ${m.tags.filter(t => t !== 'arXiv' && t !== 'Crossref' && t !== 'Metadata' && t !== 'Open Access').join(', ') || 'general reference'}`
  ).join('\n');
}

function buildPipelineErrorMessage(stage: string, rawError: string) {
  const stageMap: Record<string, string> = {
    initialization: 'initialization',
    'literature search': 'literature search',
    'idea brainstorming': 'idea brainstorming',
    'candidate proof generation': 'candidate proof generation',
    'proof verification': 'proof verification',
    'proof revision': 'proof revision',
  };

  const displayStage = stageMap[stage] || stage;

  if (/failed to fetch|networkerror|load failed/i.test(rawError)) {
    return `Pipeline failed during ${displayStage}: Unable to reach the API service. Please retry in a moment, and ensure your backend is running and network is available.`;
  }

  if (/timed out|timeout/i.test(rawError)) {
    return `Pipeline failed during ${displayStage}: The API request timed out. Please retry, or switch to a faster model if the issue persists.`;
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
    .replace(/```latex\n?/g, '')
    .replace(/```\n?/g, '')
    .replace(/\\documentclass\{[^}]+\}/g, '')
    .replace(/\\usepackage\{[^}]+\}/g, '')
    .replace(/\\begin\{document\}/g, '')
    .replace(/\\end\{document\}/g, '')
    .replace(/^\s*#+\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
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
  const [selectedModelId, setSelectedModelId] = useState('gemini-2.5-flash');
  const [kbSelectedModelId, setKbSelectedModelId] = useState('deepseek-chat');
  const [possibleIdeas, setPossibleIdeas] = useState<string[]>([]);
  const [candidateTheorems, setCandidateTheorems] = useState<CandidateTheorem[]>([]);
  const [literatureMatches, setLiteratureMatches] = useState<LiteratureMatch[]>([]);
  const [researchField, setResearchField] = useState('');
  const [literatureKeywords, setLiteratureKeywords] = useState('');
  const [keywordSource, setKeywordSource] = useState<LiteratureKeywords['source']>('rule');
  const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeBase>(() => createEmptyKnowledgeBase());
  const [isIngestingPaper, setIsIngestingPaper] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  const logEndRef = useRef<HTMLDivElement>(null);
  const proofRef = useRef<HTMLDivElement>(null);
  const ideasRef = useRef<HTMLDivElement>(null);

  const resolveModelOption = (modelId: string) =>
    MODEL_OPTIONS.find((option) => option.id === modelId) || MODEL_OPTIONS[0];
  const selectedModelOption = resolveModelOption(selectedModelId);
  const kbModelOptions = MODEL_OPTIONS.filter((option) => option.provider === 'deepseek');
  const selectedKbModelOption = resolveModelOption(kbSelectedModelId);

  const rankedKnowledgeReferences = useMemo<RankedReference[]>(() => rankKnowledgeReferences(knowledgeBase, theorem, assumptions, literatureKeywords), [knowledgeBase, theorem, assumptions, literatureKeywords]);

  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info') => {
    const now = new Date();
    const timestamp = now.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    setLogs((prev) => [...prev, { timestamp, message, type }]);
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

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
    if (proof && activeTab === 'formatted' && proofRef.current) {
      elements.push(proofRef.current);
    }
    if ((possibleIdeas.length > 0 || candidateTheorems.length > 0) && ideasRef.current) {
      elements.push(ideasRef.current);
    }

    if (elements.length === 0) return;
    window.MathJax.typesetPromise(elements).catch((err) => console.error(err));
  }, [proof, activeTab, possibleIdeas, candidateTheorems]);


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

        if (!response.ok) {
          throw new Error(`Ingest failed for ${file.name}`);
        }

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

  const searchLiterature = async (): Promise<LiteratureMatch[]> => {
    const query = `${theorem} ${assumptions} ${researchField}`.trim();
    if (!query) return [];

    try {
      const response = await fetch('/api/literature-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theorem, assumptions, researchField, keywords: literatureKeywords }),
      });

      if (!response.ok) {
        throw new Error('Literature API unavailable');
      }

      const data = await response.json();
      const matches = Array.isArray(data?.literature) ? data.literature : [];
      const keywords = typeof data?.keywords === 'object' && data.keywords !== null ? data.keywords as LiteratureKeywords : null;
      const result = matches.slice(0, 8);
      setLiteratureMatches(result);
      if (keywords) {
        setKeywordSource(keywords.source || 'rule');
        if (!literatureKeywords.trim()) {
          setLiteratureKeywords(keywords.suggested || keywords.used || '');
        }
      }
      return result;
    } catch (error) {
      addLog('Literature search failed (arXiv/Crossref). Continuing without literature.', 'warning');
      setLiteratureMatches([]);
      return [];
    }
  };

  const handleGenerate = async (overrideModelId?: string) => {
    if (isGenerating) return;

    const modelOption = resolveModelOption(overrideModelId || selectedModelId);
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

    const appendRiskSummary = (baseProof: string, riskNotes: string[]) => {
      if (riskNotes.length === 0) return baseProof;
      return `${baseProof}\n\n---\n\nRisk Notes:\n${riskNotes.map((note, index) => `${index + 1}. ${note}`).join('\n')}`;
    };

    const parseApiError = (body: ApiErrorPayload, fallback: string, status?: number, statusText?: string, rawText?: string) => {
      const headline = body.error || fallback;
      const code = body.errorCode ? ` [${body.errorCode}]` : '';
      const hint = body.userHint ? ` Hint: ${body.userHint}` : '';
      const summary = body.summary ? ` Details: ${body.summary}` : '';
      const attempts = Array.isArray(body.attempts)
        ? body.attempts
            .slice(0, 4)
            .map((attempt, idx) => `${idx + 1}) ${attempt.model || 'unknown-model'}/${attempt.promptType || 'unknown-prompt'}: ${attempt.detail || attempt.status || 'no detail'}`)
            .join('; ')
        : '';
      const attemptText = attempts ? ` Attempts: ${attempts}` : '';
      const http = typeof status === 'number' ? ` HTTP ${status}${statusText ? ` ${statusText}` : ''}.` : '';
      const raw = !body.error && rawText ? ` Raw response: ${rawText.slice(0, 280)}` : '';
      return `${headline}${code}.${http}${hint}${summary}${attemptText}${raw}`.trim();
    };

    const requestJsonWithRetry = async <T,>(params: {
      stage: string;
      endpoint: string;
      body: Record<string, unknown>;
      fallbackError: string;
      maxRetries?: number;
      retryOnHttp?: boolean;
      requestTimeoutMs?: number;
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
          response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
          });

          rawText = await response.text();
          try {
            parsedBody = rawText ? JSON.parse(rawText) : {};
          } catch {
            parsedBody = {};
          }

          if (!response.ok) {
            const canRetryHttp = retryOnHttp && (response.status >= 500 || response.status === 429 || response.status === 408);
            if (canRetryHttp && attempt < maxRetries) {
              addLog(`${stage} API returned ${response.status}, retrying (${attempt + 1}/${maxRetries})...`, 'warning');
              await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
              continue;
            }
            const bodyPayload = parsedBody as ApiErrorPayload;
            throw new Error(parseApiError(bodyPayload, fallbackError, response.status, response.statusText, rawText));
          }

          return parsedBody as T;
        } catch (error) {
          lastError = error;
          const retryableNetworkError = isNetworkFetchError(error) || isAbortTimeoutError(error);
          if (!retryableNetworkError || attempt >= maxRetries) {
            if (isAbortTimeoutError(error)) {
              throw new Error(`Request timed out after ${Math.round(requestTimeoutMs / 1000)}s.`);
            }
            throw error;
          }

          if (isAbortTimeoutError(error)) {
            addLog(`${stage} API timed out after ${Math.round(requestTimeoutMs / 1000)}s, retrying (${attempt + 1}/${maxRetries})...`, 'warning');
          } else {
            addLog(`${stage} API temporarily unreachable, retrying (${attempt + 1}/${maxRetries})...`, 'warning');
          }
          await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
        } finally {
          if (timeoutId !== null) {
            window.clearTimeout(timeoutId);
          }
        }
      }

      throw new Error(lastError instanceof Error ? lastError.message : fallbackError);
    };

    try {
      // Step 1: Literature search
      setProgress(1);
      addLog('Searching literature (arXiv + Crossref)...', 'info');
      let litMatches: LiteratureMatch[] = [];
      try {
        litMatches = await searchLiterature();
        if (litMatches.length > 0) {
          addLog(`Found ${litMatches.length} relevant papers.`, 'success');
        } else {
          addLog('No literature matches found. Proceeding without.', 'info');
        }
      } catch {
        addLog('Literature search failed, continuing without.', 'warning');
      }

      const literatureBrief = buildLiteratureBrief(litMatches);

      // Step 2: Idea brainstorming
      setProgress(2);
      try {
        const ideasData = await requestJsonWithRetry<GenerateIdeasResponse>({
          stage: 'idea brainstorming',
          endpoint: modelOption.ideasApiPath,
          body: { theorem, assumptions, literatureBrief, knowledgeReferences: rankedKnowledgeReferences, model: modelOption.id },
          fallbackError: 'Idea generation failed.',
          maxRetries: 1,
          retryOnHttp: true,
          requestTimeoutMs: modelOption.provider === 'deepseek' ? 70000 : 50000,
        });
        setPossibleIdeas(Array.isArray(ideasData.ideas) ? ideasData.ideas : []);
        setCandidateTheorems(Array.isArray(ideasData.candidateTheorems) ? ideasData.candidateTheorems : []);
        addLog('Brainstormed proof ideas and candidate theorems.', 'success');
      } catch {
        addLog('Idea generation failed, continuing with proof pipeline.', 'warning');
      }

      const fetchProof = async () => {
        const proofData = await requestJsonWithRetry<GenerateProofResponse>({
          stage: 'candidate proof generation',
          endpoint: modelOption.apiPath,
          body: { theorem, assumptions, literatureBrief, knowledgeReferences: rankedKnowledgeReferences, model: modelOption.id },
          fallbackError: 'Failed to generate proof.',
          maxRetries: 1,
          retryOnHttp: true,
          requestTimeoutMs: modelOption.provider === 'deepseek' ? 90000 : 70000,
        });

        const candidate = typeof proofData.proof === 'string' ? proofData.proof.trim() : '';
        if (!candidate) {
          throw new Error('Generator returned an empty proof. This usually indicates an upstream model timeout or empty response.');
        }
        return candidate;
      };

      const verifyProof = async (candidateProof: string) => {
        const verifyData = await requestJsonWithRetry<VerifyProofResponse>({
          stage: 'proof verification',
          endpoint: verifyApiPath,
          body: { theorem, assumptions, proof: candidateProof, model: modelOption.id },
          fallbackError: 'Proof verification failed.',
          maxRetries: 1,
          retryOnHttp: true,
        });
        return verifyData;
      };

      const reviseProof = async (candidateProof: string, feedback: string) => {
        const reviseData = await requestJsonWithRetry<ReviseProofResponse>({
          stage: 'proof revision',
          endpoint: reviseApiPath,
          body: { theorem, assumptions, proof: candidateProof, feedback, model: modelOption.id },
          fallbackError: 'Proof revision failed.',
          maxRetries: 1,
          retryOnHttp: true,
        });
        return reviseData.revisedProof || candidateProof;
      };

      let bestProof = '';
      const riskNotes: string[] = [];
      let finalProof = '';
      let completed = false;

      for (let regenerateRound = 0; regenerateRound <= maxRegenerateRounds && !completed; regenerateRound += 1) {
        setProgress(3);
        addLog(`Generator pass ${regenerateRound + 1}: drafting candidate proof...`, 'info');
        let candidateProof = await fetchProof();
        bestProof = candidateProof;

        for (let minorFixRound = 0; minorFixRound <= maxMinorFixRounds; minorFixRound += 1) {
          setProgress(4);
          addLog(`Verifier review ${minorFixRound + 1}: checking logical soundness.`, 'info');

          const verifyData = await verifyProof(candidateProof);
          const decision = verifyData.decision;

          if (decision === 'PASS') {
            setProgress(6);
            completed = true;
            finalProof = appendRiskSummary(candidateProof, riskNotes);
            addLog('Verifier accepted proof. Pipeline completed.', 'success');
            break;
          }

          if (decision === 'MINOR_FIX') {
            if (minorFixRound >= maxMinorFixRounds) {
              riskNotes.push(`Minor-fix budget reached. Last verifier feedback: ${verifyData.feedback}`);
              addLog('Minor-fix limit reached; escalating to regenerate.', 'warning');
              break;
            }

            setProgress(5);
            addLog(`Verifier requested revision: ${verifyData.feedback}`, 'warning');
            candidateProof = await reviseProof(candidateProof, verifyData.feedback);
            bestProof = candidateProof;
            addLog(`Reviser completed patch ${minorFixRound + 1}.`, 'success');
            continue;
          }

          riskNotes.push(`Critical flaw flagged: ${verifyData.feedback}`);
          addLog(`Verifier marked critically flawed: ${verifyData.feedback}`, 'error');
          break;
        }
      }

      if (!completed) {
        finalProof = appendRiskSummary(bestProof || 'No reliable proof could be generated.', [
          ...riskNotes,
          'Reached regenerate/minor-fix limits. This is the best available draft and requires manual verification.',
        ]);
        addLog('Pipeline stopped at iteration limits. Returned best draft with risk notes.', 'warning');
        setProgress(6);
      }

      setProof(finalProof);
      addLog(`Proof pipeline finished via ${modelOption.label}.`, completed ? 'success' : 'warning');
    } catch (error: unknown) {
      console.error(error);
      const rawError = error instanceof Error ? error.message : 'Unknown server error.';
      const detailedError = buildPipelineErrorMessage(pipelineStage, rawError);
      setErrorMessage(detailedError);
      addLog(`Pipeline error at ${pipelineStage}: ${rawError}`, 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const PIPELINE_STEPS = [
    { id: 1, name: 'Literature', icon: Search },
    { id: 2, name: 'Ideas', icon: Lightbulb },
    { id: 3, name: 'Generate', icon: Edit3 },
    { id: 4, name: 'Verify', icon: CheckCircle2 },
    { id: 5, name: 'Revise', icon: RefreshCw },
    { id: 6, name: 'Done', icon: Check },
  ];

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

          <select
            value={selectedModelId}
            onChange={(event) => setSelectedModelId(event.target.value)}
            className="text-sm font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5"
            disabled={isGenerating}
          >
            {MODEL_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>

          <button
            onClick={() => handleGenerate()}
            disabled={isGenerating}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg font-bold text-sm transition-all shadow-sm ${
              isGenerating
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                : 'bg-[#064e3b] text-white hover:bg-[#065f46] active:scale-[0.97]'
            }`}
          >
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
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${
                  isDone ? 'bg-emerald-50 text-emerald-700' :
                  isActive ? 'bg-[#064e3b] text-white' :
                  'text-slate-400'
                }`}>
                  {isDone ? <Check size={12} /> : <Icon size={12} />}
                  <span className="hidden sm:inline">{step.name}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <main className="flex-1 max-w-[1600px] mx-auto w-full p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 overflow-hidden">
        {/* Left column: Input + KB + Literature */}
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
                <textarea
                  value={theorem}
                  onChange={(e) => setTheorem(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3.5 text-sm focus:ring-2 focus:ring-[#064e3b]/10 focus:border-[#064e3b] transition-all min-h-[120px] resize-none leading-relaxed text-slate-700"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 block">Known Assumptions</label>
                <textarea
                  value={assumptions}
                  onChange={(e) => setAssumptions(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3.5 text-sm focus:ring-2 focus:ring-[#064e3b]/10 focus:border-[#064e3b] transition-all min-h-[100px] resize-none leading-relaxed text-slate-700"
                />
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

            <div className="flex gap-2 mb-3">
              <select
                value={kbSelectedModelId}
                onChange={(event) => setKbSelectedModelId(event.target.value)}
                className="text-[11px] font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 flex-1"
                disabled={isGenerating}
              >
                {kbModelOptions.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
              <button
                onClick={() => handleGenerate(selectedKbModelOption.id)}
                disabled={isGenerating}
                className={`flex items-center gap-1.5 text-[11px] font-bold rounded-lg px-3 py-1.5 transition-all ${
                  isGenerating
                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                    : 'bg-[#064e3b] text-white hover:bg-[#065f46]'
                }`}
              >
                {isGenerating ? <RefreshCw size={12} className="animate-spin" /> : <Database size={12} />}
                Generate (KB)
              </button>
            </div>

            <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
              {rankedKnowledgeReferences.slice(0, 5).map((reference) => (
                <div key={reference.entry.entryId} className={`rounded-md border px-2.5 py-1.5 ${reference.role === 'primary' ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-700">{reference.entry.label}</span>
                    <span className="text-[10px] font-mono text-slate-500">w={reference.score.toFixed(2)} • {reference.role}</span>
                  </div>
                  <p className="text-[10px] text-slate-500 line-clamp-1">{reference.entry.statement || reference.entry.proofSummary}</p>
                  {reference.entry.proofMethods && reference.entry.proofMethods.length > 0 && (
                    <div className="flex gap-1 mt-1">
                      {reference.entry.proofMethods.map((m) => (
                        <span key={m} className="text-[9px] px-1 py-0.5 bg-slate-100 text-slate-500 rounded font-bold">{m}</span>
                      ))}
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
              <span className="text-[10px] px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full font-bold border border-emerald-100">
                {literatureMatches.length} MATCHES
              </span>
            </div>

            <div className="relative mb-3">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={researchField}
                onChange={(event) => setResearchField(event.target.value)}
                placeholder="Research field (e.g. probability, statistics)..."
                className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 pl-9 pr-3 text-sm text-slate-700"
              />
            </div>

            <div className="mb-3">
              <label htmlFor="literature-keywords" className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block mb-1">
                Keywords ({keywordSource})
              </label>
              <input
                id="literature-keywords"
                type="text"
                value={literatureKeywords}
                onChange={(event) => setLiteratureKeywords(event.target.value)}
                placeholder="Auto-extracted when you click Generate Proof..."
                className="w-full bg-slate-50 border border-slate-200 rounded-lg py-1.5 pl-3 pr-3 text-xs text-slate-600"
              />
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {literatureMatches.map((match, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className="p-3 rounded-lg border border-slate-100 hover:border-[#064e3b]/30 hover:bg-slate-50/50 transition-colors"
                >
                  <div className="flex justify-between items-start mb-1">
                    <h3 className="text-xs font-bold text-slate-900 leading-snug flex-1 mr-2">{match.title}</h3>
                    <span className="text-[10px] font-mono font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100 shrink-0">{match.score.toFixed(2)}</span>
                  </div>
                  <p className="text-[10px] text-slate-500 mb-1.5">{match.authors} • {match.source}</p>
                  <div className="flex items-center gap-2">
                    {match.url && (
                      <a
                        href={match.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-0.5 text-[10px] text-emerald-700 hover:text-emerald-800"
                      >
                        View <ExternalLink size={10} />
                      </a>
                    )}
                    {match.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="text-[9px] px-1 py-0.5 bg-slate-100 text-slate-500 rounded font-bold uppercase">{tag}</span>
                    ))}
                  </div>
                </motion.div>
              ))}
              {literatureMatches.length === 0 && (
                <p className="text-[11px] text-slate-400 py-2">Literature is searched automatically when you click Generate Proof.</p>
              )}
            </div>
          </section>
        </div>

        {/* Right column: Output + Ideas */}
        <div className="lg:col-span-8 flex flex-col gap-6 overflow-hidden">
          {/* Final Proof Output */}
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

          {/* Ideas + Candidate Theorems */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <h2 className="font-bold text-sm text-slate-900 mb-3 flex items-center gap-2">
              <Lightbulb size={16} className="text-[#064e3b]" /> Proof Ideas & Candidate Theorems
            </h2>
            {possibleIdeas.length === 0 && candidateTheorems.length === 0 ? (
              <div className="text-sm text-slate-400">
                {isGenerating
                  ? 'AI is analyzing the workspace to propose proof ideas...'
                  : 'Click Generate Proof to get AI-proposed proof strategies.'}
              </div>
            ) : (
              <div ref={ideasRef} className="[&_.MathJax]:!text-slate-700">
                <ul className="space-y-1.5 list-disc pl-4 text-sm text-slate-700 mb-3">
                  {possibleIdeas.map((idea) => (
                    <li key={idea} className="leading-relaxed whitespace-pre-wrap">{normalizeForMathJax(idea)}</li>
                  ))}
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

          {/* Collapsible Log */}
          <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <button
              onClick={() => setShowLogs(!showLogs)}
              className="w-full px-5 py-3 flex items-center justify-between text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <span className="flex items-center gap-2"><Terminal size={14} className="text-[#064e3b]" /> Execution Log</span>
              <span className="text-[10px] text-slate-400">{logs.length} entries • {showLogs ? 'click to collapse' : 'click to expand'}</span>
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
