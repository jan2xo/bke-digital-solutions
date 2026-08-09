import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRecentAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertSameOrigin } from "@/lib/security/request";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/http";

const stages = ["DRAFT", "INTERNAL", "ALPHA", "BETA", "RELEASE_CANDIDATE", "STABLE", "LTS", "DEPRECATED", "ARCHIVED"] as const;
const schema = z.object({ lifecycle: z.enum(stages).optional(), approve: z.boolean().optional(), reviewed: z.boolean().optional(), published: z.boolean().optional(), latest: z.boolean().optional(), releaseNotes: z.string().max(10000).optional(), changelog: z.string().max(20000).optional(), channel: z.enum(["STABLE", "BETA"]).optional(), deprecated: z.boolean().optional(), rollback: z.boolean().optional(), notes: z.string().trim().max(4000).optional(), breakGlass: z.boolean().optional(), breakGlassJustification: z.string().trim().min(20).max(4000).optional() }).superRefine((value, ctx) => { if (value.breakGlass && !value.breakGlassJustification) ctx.addIssue({ code: "custom", path: ["breakGlassJustification"], message: "Break-glass justification is required" }); if (value.reviewed && value.approve) ctx.addIssue({ code: "custom", path: ["approve"], message: "Review and approval must be separate actions" }); });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request); const admin = await requireRecentAdmin(); const { id } = await params; const input = schema.parse(await request.json());
    const current = await db.productVersion.findUniqueOrThrow({ where: { id }, include: { artifacts: true, supplyChainEvidence: { include: { verificationEvidence: true } }, approvals: { orderBy: { createdAt: "desc" }, take: 1 } } });
    if (input.lifecycle) {
      const from = stages.indexOf(current.lifecycle as typeof stages[number]); const to = stages.indexOf(input.lifecycle);
      if (to !== from + 1 && !(input.lifecycle === "DEPRECATED" && from >= stages.indexOf("STABLE")) && !(input.lifecycle === "ARCHIVED" && current.lifecycle === "DEPRECATED")) throw new Error("INVALID_RELEASE_TRANSITION");
      if (to >= stages.indexOf("STABLE")) {
        if (!input.approve) throw new Error("RELEASE_APPROVAL_REQUIRED");
        const evidence = current.supplyChainEvidence;
        const pendingCompliance = await db.complianceRequirement.count({ where: { status: { not: "IMPLEMENTED" } } });
        const artifactHash = current.artifacts.map((a) => `${a.id}:${a.sha256}`).sort().join("|");
        const signatureEvidence = evidence?.verificationEvidence.some((v) => v.kind === "SIGNATURE" && v.result === "VERIFIED" && v.artifactHash === artifactHash) ?? false;
        const malwareEvidence = evidence?.verificationEvidence.some((v) => v.kind === "MALWARE_SCAN" && v.result === "CLEAN" && v.artifactHash === artifactHash) ?? false;
        const complete = Boolean(signatureEvidence && evidence?.dependencyVerified && evidence.sbomReference && evidence.provenanceStatus === "VERIFIED" && malwareEvidence && current.backupEvidence && current.complianceEvidence && pendingCompliance === 0);
        if (!complete && !(input.breakGlass && process.env.ALLOW_BREAK_GLASS === "true")) throw new Error("RELEASE_EVIDENCE_INCOMPLETE");
        const prior = current.approvals[0];
        if (!prior?.reviewedById || prior.reviewedById === admin.id || prior.createdById === admin.id) throw new Error("RELEASE_SEPARATION_REQUIRED");
      }
    }
    const version = await db.$transaction(async (tx) => {
      const updated = await tx.productVersion.update({ where: { id }, data: { lifecycle: input.lifecycle, releaseNotes: input.releaseNotes, changelog: input.changelog, channel: input.channel, active: input.lifecycle === "ARCHIVED" ? false : input.published ?? undefined, publishedAt: input.published === true ? new Date() : input.published === false ? null : undefined, deprecatedAt: input.lifecycle === "DEPRECATED" ? new Date() : input.lifecycle && String(input.lifecycle) !== "DEPRECATED" ? null : undefined } });
      if (input.reviewed || input.approve) await tx.releaseApproval.create({ data: { versionId: id, stage: input.lifecycle ?? current.lifecycle, createdById: admin.id, reviewedById: input.reviewed ? admin.id : undefined, approvedById: input.approve ? admin.id : undefined, approvedAt: input.approve ? new Date() : undefined, notes: input.notes } });
      return updated;
    });
    await audit({ actorId: admin.id, action: input.breakGlass ? "RELEASE_BREAK_GLASS_USED" : "RELEASE_LIFECYCLE_CHANGED", targetType: "ProductVersion", targetId: id, metadata: { lifecycle: input.lifecycle, approved: Boolean(input.approve), reviewed: Boolean(input.reviewed), notes: input.notes ?? "", justification: input.breakGlassJustification ?? "" } }); return NextResponse.json(version);
  } catch (e) { return apiError(e); }
}
