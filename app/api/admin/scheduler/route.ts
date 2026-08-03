import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireRecentAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";
import { schedulerHealth } from "@/lib/scheduler/health";
import { acknowledgeScheduledFailure, retryScheduledFailure, runScheduledJob, setScheduledJobEnabled } from "@/lib/scheduler/service";
import { rateLimit } from "@/lib/security/rate-limit";
import { assertSameOrigin, clientIp } from "@/lib/security/request";

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["RUN", "DRY_RUN", "PAUSE", "RESUME"]), jobKey: z.string().min(3).max(100) }),
  z.object({ action: z.enum(["RETRY", "ACKNOWLEDGE"]), runId: z.string().cuid() }),
]);
export async function GET() { try { await requireAdmin(); return NextResponse.json(await schedulerHealth()); } catch (error) { return apiError(error); } }
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireRecentAdmin();
    if (!(await rateLimit(`admin-scheduler:${admin.id}:${clientIp(request)}`, 60, 3600)).allowed) throw new Error("RATE_LIMITED");
    const input = inputSchema.parse(await request.json());
    if (input.action === "PAUSE" || input.action === "RESUME") await setScheduledJobEnabled(input.jobKey, input.action === "RESUME", admin.id);
    else if (input.action === "RETRY") await retryScheduledFailure(input.runId, admin.id);
    else if (input.action === "ACKNOWLEDGE") await acknowledgeScheduledFailure(input.runId, admin.id);
    else if ("jobKey" in input) {
      await db.auditLog.create({ data: { actorId: admin.id, action: input.action === "DRY_RUN" ? "SCHEDULER_DRY_RUN_REQUESTED" : "SCHEDULER_MANUAL_RUN_REQUESTED", targetType: "ScheduledJob", targetId: input.jobKey } });
      await runScheduledJob({ key: input.jobKey, trigger: "MANUAL", dryRun: input.action === "DRY_RUN" });
    }
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
