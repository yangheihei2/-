/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Play,
  Settings,
  Search,
  Edit3,
  BookOpen,
  CheckCircle2,
  RefreshCw,
  Terminal,
  FileText,
  Copy,
  Download,
  Cpu,
  Zap,
  Database,
  ExternalLink,
  Check,
  Lightbulb,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

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
  source: 'ai' | 'fallback' | 'manual';
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
  const [possibleIdeas, setPossibleIdeas] = useState<string[]>([]);
  const [candidateTheorems, setCandidateTheorems] = useState<CandidateTheorem[]>([]);
  const [literatureMatches, setLiteratureMatches] = useState<LiteratureMatch[]>([]);
  const [isSearchingLiterature, setIsSearchingLiterature] = useState(false);
  const [researchField, setResearchField] = useState('');
  const [literatureKeywords, setLiteratureKeywords] = useState('');
  const [keywordSource, setKeywordSource] = useState<LiteratureKeywords['source']>('fallback');

  const logEndRef = useRef<HTMLDivElement>(null);
  const proofRef = useRef<HTMLDivElement>(null);
  const ideasRef = useRef<HTMLDivElement>(null);

  const selectedModelOption = MODEL_OPTIONS.find((option) => option.id === selectedModelId) || MODEL_OPTIONS[0];


  const topReference = useMemo(
    () => [...literatureMatches].sort((a, b) => b.score - a.score)[0],
    [literatureMatches],
  );

  useEffect(() => {
    setLiteratureKeywords('');
  }, [theorem, assumptions]);

  useEffect(() => {
    const query = `${theorem} ${assumptions} ${researchField}`.trim();
    if (!query) {
      setLiteratureMatches([]);
      setLiteratureKeywords('');
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setIsSearchingLiterature(true);
      try {
        const response = await fetch('/api/literature-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ theorem, assumptions, researchField, keywords: literatureKeywords, model: selectedModelId }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error('Literature API unavailable');
        }

        const data = await response.json();
        const matches = Array.isArray(data?.literature) ? data.literature : [];
        const keywords = typeof data?.keywords === 'object' && data.keywords !== null ? data.keywords as LiteratureKeywords : null;
        setLiteratureMatches(matches.slice(0, 8));
        if (keywords) {
          setKeywordSource(keywords.source || 'fallback');
          if (!literatureKeywords.trim()) {
            setLiteratureKeywords(keywords.suggested || keywords.used || '');
          }
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        addLog('Literature search failed (arXiv/Crossref). Continuing with proof generation.', 'warning');
        setLiteratureMatches([]);
      } finally {
        setIsSearchingLiterature(false);
      }
    }, 450);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [theorem, assumptions, researchField, literatureKeywords, selectedModelId]);

  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    const now = new Date();
    const timestamp = now.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    setLogs((prev) => [...prev, { timestamp, message, type }]);
  };

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

  const handleGenerate = async () => {
    if (isGenerating) return;

    setIsGenerating(true);
    setProof(null);
    setErrorMessage(null);
    setPossibleIdeas([]);
    setCandidateTheorems([]);
    setProgress(1);
    addLog(`Generator initialized with ${selectedModelOption.label}.`, 'info');

    const verifyApiPath = selectedModelOption.provider === 'gemini' ? '/api/verify-proof' : '/api/verify-proof-deepseek';
    const reviseApiPath = selectedModelOption.provider === 'gemini' ? '/api/revise-proof' : '/api/revise-proof-deepseek';

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

    const fetchProof = async () => {
      const proofData = await requestJsonWithRetry<GenerateProofResponse>({
        stage: 'candidate proof generation',
        endpoint: selectedModelOption.apiPath,
        body: { theorem, assumptions, model: selectedModelOption.id },
        fallbackError: 'Failed to generate proof.',
        maxRetries: 1,
        retryOnHttp: true,
        requestTimeoutMs: selectedModelOption.provider === 'deepseek' ? 90000 : 70000,
      });

      const candidate = typeof proofData.proof === 'string' ? proofData.proof.trim() : '';
      if (!candidate) {
        throw new Error('Generator returned an empty proof. This usually indicates an upstream model timeout or empty response.');
      }
    };

    const verifyProof = async (candidateProof: string) => {
      const verifyData = await requestJsonWithRetry<VerifyProofResponse>({
        stage: 'proof verification',
        endpoint: verifyApiPath,
        body: { theorem, assumptions, proof: candidateProof, model: selectedModelOption.id },
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
        body: { theorem, assumptions, proof: candidateProof, feedback, model: selectedModelOption.id },
        fallbackError: 'Proof revision failed.',
        maxRetries: 1,
        retryOnHttp: true,
      });
      return reviseData.revisedProof || candidateProof;
    };

    try {
      try {
        const ideasData = await requestJsonWithRetry<GenerateIdeasResponse>({
          stage: 'idea brainstorming',
          endpoint: selectedModelOption.ideasApiPath,
          body: { theorem, assumptions, literature: literatureMatches, model: selectedModelOption.id },
          fallbackError: 'Idea generation failed.',
          maxRetries: 1,
          retryOnHttp: true,
          requestTimeoutMs: selectedModelOption.provider === 'deepseek' ? 70000 : 50000,
        });
        setPossibleIdeas(Array.isArray(ideasData.ideas) ? ideasData.ideas : []);
        setCandidateTheorems(Array.isArray(ideasData.candidateTheorems) ? ideasData.candidateTheorems : []);
        addLog('Generator brainstormed proof ideas and candidate theorems.', 'success');
      } catch {
        addLog('Idea generation failed, continuing with proof pipeline.', 'warning');
      }

      let bestProof = '';
      const riskNotes: string[] = [];
      let finalProof = '';
      let completed = false;

      for (let regenerateRound = 0; regenerateRound <= maxRegenerateRounds && !completed; regenerateRound += 1) {
        setProgress(1);
        addLog(`Generator pass ${regenerateRound + 1}: drafting candidate proof...`, 'info');
        let candidateProof = await fetchProof();
        bestProof = candidateProof;

        for (let minorFixRound = 0; minorFixRound <= maxMinorFixRounds; minorFixRound += 1) {
          setProgress(2);
          addLog(`Verifier review ${minorFixRound + 1}: checking logical soundness and assumptions.`, 'info');

          const verifyData = await verifyProof(candidateProof);
          const decision = verifyData.decision;

          if (decision === 'PASS') {
            setProgress(4);
            completed = true;
            finalProof = appendRiskSummary(candidateProof, riskNotes);
            addLog('Verifier accepted candidate proof. Pipeline completed.', 'success');
            break;
          }

          if (decision === 'MINOR_FIX') {
            if (minorFixRound >= maxMinorFixRounds) {
              riskNotes.push(`Minor-fix budget reached. Last verifier feedback: ${verifyData.feedback}`);
              addLog('Minor-fix iteration limit reached; escalating to regenerate.', 'warning');
              break;
            }

            setProgress(3);
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
        addLog('Pipeline stopped at iteration limits. Returned best available draft with risk notes.', 'warning');
        setProgress(4);
      }

      setProof(finalProof);
      addLog(`Proof pipeline finished via ${selectedModelOption.label}.`, completed ? 'success' : 'warning');
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

  return (
    <div className="min-h-screen flex flex-col font-sans">
      <header className="h-20 border-b border-slate-200 bg-white sticky top-0 z-50 px-8 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-[#064e3b] rounded flex items-center justify-center text-white shadow-sm">
            <Zap size={24} fill="white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Proof Assistant</h1>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Advanced Multi-Agent Verification</p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border border-emerald-100 rounded-full">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-bold text-emerald-700 uppercase">System Ready</span>
          </div>

          <div className="h-10 w-px bg-slate-200" />

          <div className="flex items-center gap-6">
            <div className="text-right hidden sm:block">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Model</div>
              <select
                value={selectedModelId}
                onChange={(event) => setSelectedModelId(event.target.value)}
                className="text-sm font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded px-2 py-1"
                disabled={isGenerating}
              >
                {MODEL_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className={`flex items-center gap-2 px-6 py-2.5 rounded font-bold text-sm transition-all shadow-sm ${
                isGenerating
                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                  : 'bg-[#064e3b] text-white hover:bg-[#065f46] active:scale-95'
              }`}
            >
              {isGenerating ? <RefreshCw size={18} className="animate-spin" /> : <Play size={18} fill="currentColor" />}
              {isGenerating ? 'Generating...' : 'Generate Proof'}
            </button>

            <button className="p-2 text-slate-400 hover:text-slate-600 transition-colors">
              <Settings size={20} />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1800px] mx-auto w-full p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 overflow-hidden">
        <div className="lg:col-span-4 flex flex-col gap-8">
          <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-100">
              <h2 className="font-bold text-slate-900 flex items-center gap-2">
                <Edit3 size={18} className="text-[#064e3b]" /> Workspace
              </h2>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Project ID: AM-902</span>
            </div>

            <div className="space-y-6">
              {errorMessage && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{errorMessage}</div>}
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">Theorem Statement</label>
                <textarea
                  value={theorem}
                  onChange={(e) => setTheorem(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm font-medium focus:ring-2 focus:ring-[#064e3b]/10 focus:border-[#064e3b] transition-all min-h-[140px] resize-none leading-relaxed text-slate-700"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">Known Assumptions</label>
                <textarea
                  value={assumptions}
                  onChange={(e) => setAssumptions(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm font-medium focus:ring-2 focus:ring-[#064e3b]/10 focus:border-[#064e3b] transition-all min-h-[120px] resize-none leading-relaxed text-slate-700"
                />
              </div>
            </div>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-bold text-slate-900 flex items-center gap-2">
                <BookOpen size={18} className="text-[#064e3b]" /> Literature Search
              </h2>
              <span className="text-[10px] px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full font-bold border border-emerald-100">{isSearchingLiterature ? 'SEARCHING…' : `${literatureMatches.length} MATCHES`}</span>
            </div>

            <div className="relative mb-6">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={researchField}
                onChange={(event) => setResearchField(event.target.value)}
                placeholder="Specific field (e.g. statistics, computer science)..."
                className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2.5 pl-11 pr-4 text-sm text-slate-700"
              />
            </div>

            <div className="mb-6">
              <label htmlFor="literature-keywords" className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block mb-1">
                AI Keywords ({keywordSource})
              </label>
              <input
                id="literature-keywords"
                type="text"
                value={literatureKeywords}
                onChange={(event) => setLiteratureKeywords(event.target.value)}
                placeholder="AI will summarize keywords from your theorem and assumptions..."
                className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 pl-3 pr-3 text-xs text-slate-600"
              />
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
              {literatureMatches.map((match, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.1 }}
                  className="p-4 rounded-lg border border-slate-100 hover:border-[#064e3b]/30 hover:bg-slate-50/50"
                >
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="text-sm font-bold text-slate-900 leading-snug">{match.title}</h3>
                    <span className="text-[10px] font-mono font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">{match.score.toFixed(2)}</span>
                  </div>
                  <p className="text-xs text-slate-500 mb-3">{match.authors} • {match.source}</p>
                  {match.url && (
                    <a
                      href={match.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-emerald-700 hover:text-emerald-800 mb-2"
                    >
                      View source <ExternalLink size={12} />
                    </a>
                  )}
                  <div className="flex gap-2">
                    {match.tags.map((tag) => (
                      <span key={tag} className="text-[9px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded font-bold uppercase tracking-wider">{tag}</span>
                    ))}
                  </div>
                </motion.div>
              ))}
            </div>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h2 className="font-bold text-xs text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Lightbulb size={14} /> Possible Proof Ideas & Candidate Theorems
            </h2>
            {possibleIdeas.length === 0 && candidateTheorems.length === 0 ? (
              <div className="text-sm text-slate-400">
                {isGenerating
                  ? 'AI is analyzing the current workspace to propose possible proof ideas...'
                  : 'Click Generate Proof to let AI produce possible proof ideas for this workspace.'}
              </div>
            ) : (
              <div ref={ideasRef} className="[&_.MathJax]:!text-slate-700">
                <ul className="space-y-2 list-disc pl-4 text-sm text-slate-700 mb-4">
                  {possibleIdeas.map((idea) => (
                    <li key={idea} className="leading-relaxed whitespace-pre-wrap">{normalizeForMathJax(idea)}</li>
                  ))}
                </ul>
                <div className="space-y-2">
                  {candidateTheorems.map((theorem) => (
                    <div key={theorem.name} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                      <div className="text-xs font-bold text-slate-800 whitespace-pre-wrap [&_.MathJax]:!text-slate-800">{normalizeForMathJax(theorem.name)}</div>
                      <div className="text-[11px] text-slate-500 whitespace-pre-wrap [&_.MathJax]:!text-slate-500">{normalizeForMathJax(theorem.why)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>

        <div className="lg:col-span-3 flex flex-col gap-8">
          <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm flex flex-col h-full">
            <div className="flex items-center justify-between mb-8 pb-4 border-b border-slate-100">
              <h2 className="font-bold text-slate-900 flex items-center gap-2"><CheckCircle2 size={18} className="text-[#064e3b]" /> Progress</h2>
              <div className="flex gap-1">{[1, 2, 3, 4].map((i) => <div key={i} className={`w-1.5 h-1.5 rounded-full ${progress >= i ? 'bg-[#064e3b]' : 'bg-slate-200'}`} />)}</div>
            </div>

            <div className="space-y-8 flex-1">
              {[
                { id: 1, name: 'Generator', desc: 'Drafting / regenerating candidate proof' },
                { id: 2, name: 'Verifier', desc: 'PASS / MINOR_FIX / REGENERATE decision' },
                { id: 3, name: 'Reviser', desc: 'Applies targeted patch for minor flaws' },
                { id: 4, name: 'Finalize', desc: 'Return final proof or best draft + risks' },
              ].map((step) => (
                <div key={step.id} className="flex items-start gap-4">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${progress > step.id ? 'bg-emerald-100 text-emerald-600' : progress === step.id ? 'bg-[#064e3b] text-white' : 'border-2 border-slate-200 text-slate-400'}`}>
                    {progress > step.id ? <Check size={14} /> : step.id}
                  </div>
                  <div>
                    <div className={`text-sm font-bold ${progress === step.id ? 'text-[#064e3b]' : 'text-slate-900'}`}>{step.name}</div>
                    <div className="text-xs text-slate-400">{step.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-8 pt-6 border-t border-slate-100">
              <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2 mb-4"><Terminal size={14} /> System Execution Log</h3>
              <div className="bg-slate-900 rounded-lg p-4 font-mono text-[11px] h-64 overflow-y-auto custom-scrollbar leading-relaxed">
                {logs.map((log, idx) => (
                  <div key={idx} className="mb-1">
                    <span className="text-slate-500">[{log.timestamp}]</span>{' '}
                    <span className={log.type === 'success' ? 'text-emerald-400' : log.type === 'warning' ? 'text-amber-400' : log.type === 'error' ? 'text-rose-400' : 'text-slate-300'}>{log.message}</span>
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            </div>
          </section>
        </div>

        <div className="lg:col-span-5 flex flex-col gap-8 overflow-hidden">
          <section className="bg-white border border-slate-200 rounded-xl flex-1 flex flex-col shadow-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <h2 className="font-bold text-slate-900 flex items-center gap-2"><FileText size={18} className="text-[#064e3b]" /> Final Proof Output</h2>
              <div className="flex bg-white border border-slate-200 rounded p-1">
                <button onClick={() => setActiveTab('source')} className={`px-3 py-1 text-xs font-bold rounded transition-all ${activeTab === 'source' ? 'bg-slate-100 text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}>Source</button>
                <button onClick={() => setActiveTab('formatted')} className={`px-3 py-1 text-xs font-bold rounded transition-all ${activeTab === 'formatted' ? 'bg-[#064e3b] text-white shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>Compiled</button>
              </div>
            </div>

            <div className="flex-1 p-8 overflow-y-auto custom-scrollbar bg-white">
              <AnimatePresence mode="wait">
                {!proof ? (
                  <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full flex flex-col items-center justify-center text-slate-300 gap-4">
                    <FileText size={64} strokeWidth={1} />
                    <p className="text-sm font-medium">No proof generated yet.</p>
                  </motion.div>
                ) : (
                  <motion.article key="content" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-3xl mx-auto font-serif text-slate-800 leading-relaxed">
                    {activeTab === 'formatted' ? (
                      <div>
                        <div className="text-center mb-8">
                          <h3 className="text-xl font-bold text-slate-900 mb-1 font-serif">Compiled Mathematical Proof</h3>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] font-sans">MathJax Rendering</p>
                        </div>
                        <div ref={proofRef} className="whitespace-pre-wrap text-base leading-7 [&_.MathJax]:!text-slate-800">{normalizeForMathJax(proof)}</div>
                      </div>
                    ) : (
                      <pre className="font-mono text-xs bg-slate-50 p-6 rounded-lg border border-slate-200 overflow-x-auto">{proof}</pre>
                    )}
                  </motion.article>
                )}
              </AnimatePresence>
            </div>

            <div className="p-4 border-t border-slate-100 bg-white flex justify-between">
              <button className="flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-[#064e3b] transition-colors px-4 py-2"><Copy size={16} /> Copy LaTeX</button>
              <button className="flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-[#064e3b] transition-colors px-4 py-2"><Download size={16} /> Export PDF</button>
            </div>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h2 className="font-bold text-xs text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2"><ExternalLink size={14} /> Grounded References</h2>
            <div className="space-y-4">
              <div className="p-4 bg-slate-50 rounded-lg border-l-4 border-[#064e3b]">
                <p className="text-[10px] font-bold text-[#064e3b] uppercase mb-2 tracking-wider">Top matched reference</p>
                <p className="text-sm font-serif italic text-slate-700 leading-relaxed">{topReference?.title} — {topReference?.authors}</p>
                <p className="text-[10px] text-slate-400 mt-3 font-bold">{topReference?.source}</p>
              </div>
            </div>
          </section>
        </div>
      </main>

      <footer className="h-12 border-t border-slate-200 bg-white flex items-center px-8 justify-between text-[10px] text-slate-500 font-bold uppercase tracking-widest">
        <div className="flex gap-8">
          <span className="flex items-center gap-2"><Cpu size={14} /> GPU Usage: 38%</span>
          <span className="flex items-center gap-2"><Zap size={14} /> Latency: 340ms</span>
          <span className="flex items-center gap-2"><Database size={14} /> KB: 4.2GB</span>
        </div>
      </footer>
    </div>
  );
}
