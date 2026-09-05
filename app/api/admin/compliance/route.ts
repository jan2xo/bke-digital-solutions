import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin, requireRecentAdmin } from "@/lib/auth";
import { apiError } from "@/v2/apps/web/http/api-error";
import { assertSameOrigin, clientIp } from "@/v2/apps/web/http/request";
import { rateLimit } from "@/v2/apps/web/http/rate-limit";
import { COMPLIANCE_STATUSES } from "@/lib/compliance";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("STATUS"), id: z.string().min(1), status: z.enum(COMPLIANCE_STATUSES) }),
  z.object({ action: z.literal("EVIDENCE"), id: z.string().min(1), kind: z.string().trim().min(1).max(80), summary: z.string().trim().min(1).max(500), reference: z.string().trim().max(300).optional() }),
  z.object({ action: z.literal("COMPLETE"), id: z.string().min(1), confirmation: z.literal(true) }),
  z.object({ action: z.literal("REOPEN"), id: z.string().min(1), confirmation: z.literal(true), status: z.enum(COMPLIANCE_STATUSES) }),
]);

export async function GET() {
  try { await requireAdmin(); return NextResponse.json(await db.complianceRequirement.findMany({ include: { evidence: { orderBy: { createdAt: "desc" }, take: 10, select: { id: true, kind: true, summary: true, reference: true, createdAt: true } } }, orderBy: [{ category: "asc" }, { title: "asc" }] })); }
  catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireRecentAdmin();
    if (!(await rateLimit(`admin-compliance:${admin.id}:${clientIp(request)}`, 60, 3600)).allowed) throw new Error("RATE_LIMITED");
    const input = schema.parse(await request.json());
    const requirement = await db.complianceRequirement.findUnique({ where: { id: input.id } });
    if (!requirement) throw new Error("NOT_FOUND");
    if (input.action === "STATUS") {
      if (requirement.status === "IMPLEMENTED") throw new Error("COMPLIANCE_IMPLEMENTED_IMMUTABLE");
      await db.complianceRequirement.update({ where: { id: input.id }, data: { status: input.status, reviewedAt: null } });
      await db.auditLog.create({ data: { actorId: admin.id, action: "COMPLIANCE_STATUS_CHANGED", targetType: "ComplianceRequirement", targetId: input.id, metadata: { status: input.status } } });
    } else if (input.action === "EVIDENCE") {
      await db.complianceEvidence.create({ data: { requirementId: input.id, kind: input.kind, summary: input.summary, reference: input.reference, recordedBy: admin.id } });
      await db.auditLog.create({ data: { actorId: admin.id, action: "COMPLIANCE_EVIDENCE_RECORDED", targetType: "ComplianceRequirement", targetId: input.id, metadata: { kind: input.kind } } });
    } else if (input.action === "COMPLETE") {
      if (requirement.status === "IMPLEMENTED") return NextResponse.json({ ok: true, status: "IMPLEMENTED" });
      await db.complianceRequirement.update({ where: { id: input.id }, data: { status: "IMPLEMENTED", reviewedAt: new Date(), decision: "OWNER_ACCEPTED" } });
      await db.auditLog.create({ data: { actorId: admin.id, action: "COMPLIANCE_REQUIREMENT_IMPLEMENTED", targetType: "ComplianceRequirement", targetId: input.id, metadata: { previousStatus: requirement.status, decision: "OWNER_ACCEPTED" } } });
    } else {
      if (requirement.status !== "IMPLEMENTED") throw new Error("COMPLIANCE_REOPEN_REQUIRES_IMPLEMENTED");
      await db.complianceRequirement.update({ where: { id: input.id }, data: { status: input.status, reviewedAt: null, decision: null } });
      await db.auditLog.create({ data: { actorId: admin.id, action: "COMPLIANCE_REQUIREMENT_REOPENED", targetType: "ComplianceRequirement", targetId: input.id, metadata: { previousStatus: "IMPLEMENTED", status: input.status } } });
    }
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
