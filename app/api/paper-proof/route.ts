import { NextResponse } from "next/server";
import { callDeepSeekChat } from "../../../lib/deepseek/client";
import { PAPER_LIBRARY, type PaperProof } from "../../../lib/papers/library";

export const runtime = "nodejs";

type PaperMatch = PaperProof & { score: number };

type PaperProofResponse = {
  proof: string;
  usedPapers: Array<{ id: string; title: string; usage: string }>;
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
  const ranked: PaperMatch[] = PAPER_LIBRARY.map((paper) => ({
    ...paper,
    score: scorePaper(paper, tokens)
  }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, maxPapers));

  return ranked;
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

export async function POST(request: Request) {
  const body = await request.json();
  const theorem = String(body?.theorem ?? "");
  const background = String(body?.background ?? "");
  const assumptions = String(body?.assumptions ?? "");
  const imageText = String(body?.imageText ?? "");
  const model = String(body?.model ?? "deepseek-chat");
  const temperature = Number(body?.temperature ?? 0.2);
  const maxPapers = Number(body?.maxPapers ?? 3);

  const query = [theorem, background, assumptions, imageText].filter(Boolean).join("\n");
  const selected = selectPapers(query, maxPapers);

  if (!selected.length) {
    return NextResponse.json({ proof: "", usedPapers: [], papers: [] });
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

  try {
    const { content } = await callDeepSeekChat({
      messages: [
        { role: "system", content: buildSystemPrompt() },
        {
          role: "user",
          content: [
            "Target theorem:",
            theorem || "(empty)",
            "",
            "Background context:",
            background || "(empty)",
            "",
            "Assumptions:",
            assumptions || "(empty)",
            "",
            "OCR text:",
            imageText || "(empty)",
            "",
            "Paper proofs:",
            paperContext
          ].join("\n")
        }
      ],
      model,
      temperature,
      stream: false,
      response_format: { type: "json_object" },
      timeoutMs: 120000
    });

    const parsed = JSON.parse(content ?? "{}") as PaperProofResponse;
    return NextResponse.json({
      proof: parsed.proof ?? "",
      usedPapers: parsed.usedPapers ?? [],
      papers: selected.map((paper) => ({
        id: paper.id,
        title: paper.title,
        score: paper.score,
        proofExcerpt: paper.proofExcerpt
      }))
    });
  } catch (error) {
    const message = (error as Error).message || "Failed to generate proof.";
    return NextResponse.json(
      {
        error: message,
        proof: "",
        usedPapers: selected.map((paper) => ({
          id: paper.id,
          title: paper.title,
          usage: "Selected for relevance but proof generation failed."
        })),
        papers: selected.map((paper) => ({
          id: paper.id,
          title: paper.title,
          score: paper.score,
          proofExcerpt: paper.proofExcerpt
        }))
      },
      { status: 500 }
    );
  }
}
