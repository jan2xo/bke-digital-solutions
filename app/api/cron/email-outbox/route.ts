import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/security/crypto";
import { runScheduledJob } from "@/lib/scheduler/service";

export async function POST(request: Request) {
  const provided = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!safeEqual(provided, env.CRON_SECRET)) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  return NextResponse.json(await runScheduledJob({ key: "email.outbox", trigger: "CRON" }));
}
