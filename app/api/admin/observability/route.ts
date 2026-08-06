import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireRecentAdmin } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { db } from "@/lib/db";
import { assertSameOrigin } from "@/lib/security/request";
import { collectObservability, syncObservabilityAlerts } from "@/lib/observability/metrics";

const actionSchema = z.object({ id: z.string().cuid(), action: z.enum(["ACKNOWLEDGE", "RESOLVE"]) });

export async function GET() { try { await requireAdmin(); const snapshot = await collectObservability(); return NextResponse.json({ ...snapshot, alerts: await syncObservabilityAlerts(snapshot) }); } catch (error) { return apiError(error); } }

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireRecentAdmin();
    const input = actionSchema.parse(await request.json());
    const now = new Date();
    const data = input.action === "ACKNOWLEDGE" ? { status: "ACKNOWLEDGED" as const, acknowledgedAt: now, acknowledgedById: admin.id } : { status: "RESOLVED" as const, resolvedAt: now, resolvedById: admin.id };
    const alert = await db.observabilityAlert.update({ where: { id: input.id }, data });
    await db.auditLog.create({ data: { actorId: admin.id, action: `OBSERVABILITY_ALERT_${input.action}`, targetType: "ObservabilityAlert", targetId: alert.id } });
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
