import { NextResponse } from "next/server";
import { getCronEnvironment } from "@/v2/apps/web/config/environment";
import { safeEqual } from "@/v2/platform/host/security/crypto";
import { runScheduledJob } from "@/lib/scheduler/service";

export async function POST(request: Request) {
  const provided = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!safeEqual(provided, getCronEnvironment().cronSecret)) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  return NextResponse.json(await runScheduledJob({ key: "subscriptions.renewal-reminders", trigger: "CRON" }));
}
