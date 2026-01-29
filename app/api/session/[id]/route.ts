import { NextResponse } from "next/server";
import { getSessionRecord } from "../../../../lib/sessions/store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const record = getSessionRecord(params.id);
  if (!record) {
    return NextResponse.json({ message: "Session not found" }, { status: 404 });
  }
  return NextResponse.json(record.state);
}
