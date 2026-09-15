import { NextResponse } from "next/server";
import { readiness } from "@/v2/apps/web/health/readiness";

export const dynamic = "force-dynamic";
export async function GET(request?: Request) {
  const correlationId = request?.headers.get("x-correlation-id") ?? undefined;
  const result = await readiness(correlationId);
  return NextResponse.json(
    { status: result.ready ? "ready" : "unavailable", dependencies: result.checks },
    {
      status: result.ready ? 200 : 503,
      headers: {
        "cache-control": "no-store",
        ...(correlationId ? { "x-correlation-id": correlationId } : {}),
      },
    },
  );
}
