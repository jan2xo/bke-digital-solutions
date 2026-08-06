import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin, requireRecentAdmin } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { assertSameOrigin, clientIp } from "@/lib/security/request";
import { rateLimit } from "@/lib/security/rate-limit";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("STATUS"), id: z.string().min(1), status: z.enum(["IMPLEMENTED", "PENDING_OWNER_DECISION", "PENDING_LAWYER_REVIEW", "PENDING_ACCOUNTANT_REVIEW", "PENDING_DPO_REVIEW", "PENDING_REGULATORY_APPROVAL"]) }),
  z.object({ action: z.literal("EVIDENCE"), id: z.string().min(1), kind: z.string().trim().min(1).max(80), summary: z.string().trim().min(1).max(500), reference: z.string().trim().max(300).optional() }),
]);

export async function GET() { try { await requireAdmin(); return NextResponse.json(await db.complianceRequirement.findMany({ include: { evidence: { orderBy: { createdAt: "desc" }, take: 10, select: { id: true, kind: true, summary: true, reference: true, createdAt: true } } }, orderBy: [{ category: "asc" }, { title: "asc" }] })); } catch (error) { return apiError(error); } }
export async function POST(request: Request) { try { assertSameOrigin(request); const admin = await requireRecentAdmin(); const limited = await rateLimit(`admin-compliance:${admin.id}:${clientIp(request)}`, 60, 3600); if (!limited.allowed) throw new Error("RATE_LIMITED"); const input = schema.parse(await request.json()); const requirement = await db.complianceRequirement.findUnique({ where: { id: input.id } }); if (!requirement) throw new Error("NOT_FOUND"); if (input.action === "STATUS") { await db.complianceRequirement.update({ where: { id: input.id }, data: { status: input.status, reviewedAt: input.status === "IMPLEMENTED" ? new Date() : null } }); await db.auditLog.create({ data: { actorId: admin.id, action: "COMPLIANCE_STATUS_CHANGED", targetType: "ComplianceRequirement", targetId: input.id, metadata: { status: input.status } } }); } else { await db.complianceEvidence.create({ data: { requirementId: input.id, kind: input.kind, summary: input.summary, reference: input.reference, recordedBy: admin.id } }); await db.auditLog.create({ data: { actorId: admin.id, action: "COMPLIANCE_EVIDENCE_RECORDED", targetType: "ComplianceRequirement", targetId: input.id, metadata: { kind: input.kind } } }); } return NextResponse.json({ ok: true }); } catch (error) { return apiError(error); } }
