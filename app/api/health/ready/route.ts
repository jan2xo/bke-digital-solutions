import { NextResponse } from "next/server";
import { readiness } from "@/lib/health";

export const dynamic = "force-dynamic";
export async function GET() {
  const result = await readiness();
  return NextResponse.json({ status: result.ready ? "ready" : "unavailable", dependencies: result.checks }, { status: result.ready ? 200 : 503, headers: { "cache-control": "no-store" } });
}
