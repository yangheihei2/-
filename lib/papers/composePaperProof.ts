import { callDeepSeekChat } from "../deepseek/client";
import { PAPER_LIBRARY, type PaperProof } from "./library";

export type PaperSourceUsage = { id: string; title: string; usage: string };

export type PaperProofResult = {
  proof: string;
  usedPapers: PaperSourceUsage[];
  papers: Array<{ id: string; title: string; score: number; proofExcerpt: string }>;
};

type PaperMatch = PaperProof & { score: number };

type PaperProofResponse = {
  proof: string;
  usedPapers: PaperSourceUsage[];
};

type GeneratePaperProofInput = {
  theorem: string;
  assumptions: string;
  background: string;
  imageText: string;
  model: string;
  temperature: number;
  maxPapers?: number;
};

function tokenize(text: string) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length > 2);
}

function scorePaper(paper: PaperProof, tokens: string[]) {
  if (!tokens.length) return 0;
  const haystack = `${paper.title} ${paper.keywords.join(" ")} ${paper.proofExcerpt}`.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) score += 1;
  }
  return score;
}

function selectPapers(query: string, maxPapers: number) {
  const tokens = tokenize(query);
  return PAPER_LIBRARY.map((paper) => ({
    ...paper,
    score: scorePaper(paper, tokens)
  }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, maxPapers));
}

function buildSystemPrompt() {
  return [
    "You are a proof composer.",
    "Use the provided paper proof excerpts to build a complete proof for the target theorem.",
    "Each step must explain which paper(s) are used and how the step follows.",
    "Output ONLY valid JSON with fields: proof, usedPapers.",
    "proof must be step-structured; each step starts with 'Step k:' (k=1,2,3...).",
    "usedPapers is an array of {id, title, usage} describing how each paper contributed.",
    "Do not invent citations that are not in the provided paper list."
  ].join("\n");
}

export async function generatePaperProof(input: GeneratePaperProofInput): Promise<PaperProofResult> {
  const maxPapers = input.maxPapers ?? 3;
  const query = [input.theorem, input.background, input.assumptions, input.imageText]
    .filter(Boolean)
    .join("\n");
  const selected: PaperMatch[] = selectPapers(query, maxPapers);

  if (!selected.length) {
    return { proof: "", usedPapers: [], papers: [] };
  }

  const paperContext = selected
    .map((paper) => {
      return [
        `Paper ID: ${paper.id}`,
        `Title: ${paper.title}`,
        `Authors: ${paper.authors} (${paper.year})`,
        `Proof Excerpt: ${paper.proofExcerpt}`
      ].join("\n");
    })
    .join("\n\n---\n\n");

  const { content } = await callDeepSeekChat({
    messages: [
      { role: "system", content: buildSystemPrompt() },
      {
        role: "user",
        content: [
          "Target theorem:",
          input.theorem || "(empty)",
          "",
          "Background context:",
          input.background || "(empty)",
          "",
          "Assumptions:",
          input.assumptions || "(empty)",
          "",
          "OCR text:",
          input.imageText || "(empty)",
          "",
          "Paper proofs:",
          paperContext
        ].join("\n")
      }
    ],
    model: input.model,
    temperature: input.temperature,
    stream: false,
    response_format: { type: "json_object" },
    timeoutMs: 120000
  });

  const parsed = JSON.parse(content ?? "{}") as PaperProofResponse;
  return {
    proof: parsed.proof ?? "",
    usedPapers: parsed.usedPapers ?? [],
    papers: selected.map((paper) => ({
      id: paper.id,
      title: paper.title,
      score: paper.score,
      proofExcerpt: paper.proofExcerpt
    }))
  };
}
