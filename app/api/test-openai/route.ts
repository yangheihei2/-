import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const keyOk = !!process.env.OPENAI_API_KEY;
  if (!keyOk) return NextResponse.json({ ok: false, error: "OPENAI_API_KEY missing" }, { status: 500 });

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Say ok" }],
      temperature: 0
    })
  });

  const text = await res.text();
  return NextResponse.json({ status: res.status, body: text.slice(0, 300) });
}
