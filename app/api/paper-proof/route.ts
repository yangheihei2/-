import { NextResponse } from "next/server";
import { generatePaperProof } from "../../../lib/papers/composePaperProof";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json();
  const theorem = String(body?.theorem ?? "");
  const background = String(body?.background ?? "");
  const assumptions = String(body?.assumptions ?? "");
  const imageText = String(body?.imageText ?? "");
  const model = String(body?.model ?? "deepseek-chat");
  const temperature = Number(body?.temperature ?? 0.2);
  const maxPapers = Number(body?.maxPapers ?? 3);

  try {
    const result = await generatePaperProof({
      theorem,
      background,
      assumptions,
      imageText,
      model,
      temperature,
      maxPapers
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = (error as Error).message || "Failed to generate proof.";
    return NextResponse.json(
      {
        error: message,
        proof: "",
        usedPapers: [],
        papers: []
      },
      { status: 500 }
    );
  }
}
