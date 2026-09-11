import { NextResponse } from "next/server";
import { collectObservability } from "@/v2/apps/web/observability";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await collectObservability();
  return NextResponse.json({ overall: result.overall, observedAt: result.observedAt, cards: result.cards }, { headers: { "cache-control": "no-store" } });
}
