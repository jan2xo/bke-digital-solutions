import { NextResponse } from "next/server";
import { getCronEnvironment } from "@/v2/apps/web/config/environment";
import { safeEqual } from "@/v2/platform/host/security/crypto";
import { runDueScheduledJobs } from "@/v2/apps/web/scheduler/service";

export async function POST(request: Request) {
  const provided = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!safeEqual(provided, getCronEnvironment().cronSecret)) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const result = await runDueScheduledJobs("CRON");
  return NextResponse.json({ ok: true, recovered: result.recovered, retries: result.retries, due: result.due });
}
