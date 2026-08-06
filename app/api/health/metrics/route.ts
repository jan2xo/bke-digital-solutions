import { NextResponse } from "next/server";
import { collectObservability } from "@/lib/observability/metrics";

export async function GET() {
  const result = await collectObservability();
  return NextResponse.json({ overall: result.overall, observedAt: result.observedAt, cards: result.cards });
}
