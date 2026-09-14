import { NextResponse } from "next/server";

/** Health check: no expone información sensible. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "faltalamuni",
    time: new Date().toISOString(),
  });
}
