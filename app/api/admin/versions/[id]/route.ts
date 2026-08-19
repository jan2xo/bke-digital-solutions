import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRecentAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertSameOrigin } from "@/lib/security/request";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/http";
import { env } from "@/lib/env";
import { buildReleaseManifest, canonicalizeManifest, manifestHash } from "@/lib/supply-chain/manifest";
import { hasCurrentCleanMalwareEvidence } from "@/lib/supply-chain/malware-gate";
import { evaluateSupplyChainSecurity } from "@/lib/supply-chain/controls";
import { evaluateReleaseGate } from "@/lib/releases/release-gate";
import { rateLimit } from "@/lib/security/rate-limit";
import { isCommercialComplianceEvidence } from "@/lib/supply-chain/compliance-certification";

const stages = ["DRAFT", "INTERNAL", "ALPHA", "BETA", "RELEASE_CANDIDATE", "STABLE", "LTS", "DEPRECATED", "ARCHIVED"] as const;
const schema = z.object({ lifecycle: z.enum(stages).optional(), approve: z.boolean().optional(), reviewed: z.boolean().optional(), published: z.boolean().optional(), latest: z.boolean().optional(), releaseNotes: z.string().max(10000).optional(), changelog: z.string().max(20000).optional(), channel: z.enum(["STABLE", "BETA"]).optional(), deprecated: z.boolean().optional(), rollback: z.boolean().optional(), notes: z.string().trim().max(4000).optional(), breakGlass: z.boolean().optional(), breakGlassJustification: z.string().trim().min(20).max(4000).optional() }).superRefine((value, ctx) => { if (value.breakGlass && !value.breakGlassJustification) ctx.addIssue({ code: "custom", path: ["breakGlassJustification"], message: "Break-glass justification is required" }); });
function payloadHashFor(version: { productId: string; product: { slug: string }; id: string; version: string; artifacts: Array<{ id: string; objectKey: string; sha256: string; sizeBytes: bigint; contentType: string }> }) { return manifestHash(canonicalizeManifest(buildReleaseManifest({ productId: version.productId, productSlug: version.product.slug, versionId: version.id, version: version.version, signingKeyId: env.SUPPLY_CHAIN_SIGNING_KEY_ID, artifacts: version.artifacts.map((a) => ({ id: a.id, objectKey: a.objectKey, sha256: a.sha256, sizeBytes: Number(a.sizeBytes), contentType: a.contentType })) })) ); }

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request); const admin = await requireRecentAdmin(); const { id } = await params; const input = schema.parse(await request.json());
    if (!(await rateLimit(`admin-release-lifecycle:${admin.id}:${id}`, 20, 3600)).allowed) throw new Error("RATE_LIMITED");
    const current = await db.productVersion.findUniqueOrThrow({ where: { id }, include: { product: true, artifacts: true, supplyChainEvidence: { include: { verificationEvidence: true } }, approvals: { orderBy: { createdAt: "desc" }, take: 50 } } });
    if (input.published === true && !["STABLE", "LTS"].includes(input.lifecycle ?? current.lifecycle)) throw new Error("RELEASE_PUBLICATION_REQUIRES_STABLE");
    if (input.published === true && !input.approve) throw new Error("RELEASE_APPROVAL_REQUIRED");
    const requestedPayloadHash = payloadHashFor(current);
    const payloadApproval = current.approvals.find((approval) => approval.payloadHash === requestedPayloadHash);
    if (input.approve && !input.reviewed && !payloadApproval?.reviewedAt) throw new Error("RELEASE_REVIEW_REQUIRED");
    if (input.lifecycle || input.published === true) {
      const from = stages.indexOf(current.lifecycle as typeof stages[number]); const to = stages.indexOf((input.lifecycle ?? current.lifecycle) as typeof stages[number]);
      if (input.lifecycle && input.lifecycle !== current.lifecycle && to !== from + 1 && !(input.lifecycle === "DEPRECATED" && from >= stages.indexOf("STABLE")) && !(input.lifecycle === "ARCHIVED" && current.lifecycle === "DEPRECATED")) throw new Error("INVALID_RELEASE_TRANSITION");
      if (to >= stages.indexOf("STABLE")) {
        if (!input.approve) throw new Error("RELEASE_APPROVAL_REQUIRED");
        const evidence = current.supplyChainEvidence;
        const pendingCompliance = await db.complianceRequirement.count({ where: { status: { not: "IMPLEMENTED" } } });
        const artifactHash = manifestHash(canonicalizeManifest(buildReleaseManifest({ productId: current.productId, productSlug: current.product.slug, versionId: current.id, version: current.version, signingKeyId: env.SUPPLY_CHAIN_SIGNING_KEY_ID, artifacts: current.artifacts.map((a) => ({ id: a.id, objectKey: a.objectKey, sha256: a.sha256, sizeBytes: Number(a.sizeBytes), contentType: a.contentType })) })));
        const signatureEvidence = evidence?.verificationEvidence.some((v) => v.kind === "SIGNATURE" && v.result === "VERIFIED" && v.artifactHash === artifactHash) ?? false;
        const malwareEvidence = hasCurrentCleanMalwareEvidence(current.artifacts, (evidence?.verificationEvidence ?? []).filter((v) => v.kind === "MALWARE_SCAN"), artifactHash);
        const currentEvidence = (kind: string) => evidence?.verificationEvidence.some((v) => v.kind === kind && v.result === "VERIFIED" && v.artifactHash === artifactHash) ?? false;
        const supplyChainSecurity = evaluateSupplyChainSecurity({ currentHash: artifactHash, artifacts: current.artifacts, evidence: evidence?.verificationEvidence ?? [], certificateStatus: evidence?.certificateStatus, malwareStatus: evidence?.malwareStatus });
        const prior = current.approvals.find((approval) => approval.payloadHash === artifactHash);
        const complianceCurrent = evidence?.verificationEvidence.some((item) => isCommercialComplianceEvidence(item, current.id, artifactHash)) ?? false;
        const gate = evaluateReleaseGate({ signatureVerified: signatureEvidence && supplyChainSecurity.integrityVerified, dependenciesVerified: Boolean(evidence?.dependencyVerified) && currentEvidence("DEPENDENCIES"), sbomPresent: Boolean(evidence?.sbomReference) && currentEvidence("SBOM"), provenanceVerified: evidence?.provenanceStatus === "VERIFIED" && currentEvidence("PROVENANCE"), malwareClean: malwareEvidence && supplyChainSecurity.scanCurrent, backupEvidencePresent: Boolean(current.backupEvidence) && currentEvidence("BACKUP"), complianceEvidencePresent: Boolean(current.complianceEvidence) && complianceCurrent, migrationEvidencePresent: Boolean(current.migrationEvidence) && currentEvidence("MIGRATION"), pendingComplianceCount: pendingCompliance, reviewedById: prior?.reviewedById, priorCreatedById: prior?.createdById, approvingAdminId: admin.id, breakGlassAllowed: input.breakGlass && env.ALLOW_BREAK_GLASS === "true", supplyChainSafe: supplyChainSecurity.releasable });
        if (!gate.ready) throw new Error("RELEASE_EVIDENCE_INCOMPLETE");
      }
    }
    const version = await db.$transaction(async (tx) => {
      const eligible = input.lifecycle === "STABLE" || input.lifecycle === "LTS";
      if (eligible && input.published !== false) await tx.productVersion.updateMany({ where: { productId: current.productId, id: { not: id }, active: true, publishedAt: { not: null }, lifecycle: { in: ["STABLE", "LTS"] } }, data: { isLatest: false } });
      const now = new Date();
      const updated = await tx.productVersion.update({ where: { id }, data: { lifecycle: input.lifecycle, releaseNotes: input.releaseNotes, changelog: input.changelog, channel: input.channel, active: input.lifecycle === "ARCHIVED" ? false : eligible && input.published !== false ? true : input.published ?? undefined, publishedAt: input.published === true || (eligible && input.published !== false && !current.publishedAt) ? now : input.published === false ? null : undefined, isLatest: eligible && input.published !== false ? true : input.lifecycle === "ARCHIVED" || input.published === false ? false : undefined, deprecatedAt: input.lifecycle === "DEPRECATED" ? now : input.lifecycle && String(input.lifecycle) !== "DEPRECATED" ? null : undefined } });
      if (input.lifecycle === "ARCHIVED" || input.lifecycle === "DEPRECATED" || input.published === false) {
        const fallback = await tx.productVersion.findFirst({ where: { productId: current.productId, id: { not: id }, active: true, publishedAt: { not: null }, lifecycle: { in: ["STABLE", "LTS"] } }, orderBy: [{ publishedAt: "desc" }, { releasedAt: "desc" }] });
        if (fallback) await tx.productVersion.update({ where: { id: fallback.id }, data: { isLatest: true } });
      }
      if (input.reviewed || input.approve) {
        const existingApproval = current.approvals.find((approval) => approval.payloadHash === requestedPayloadHash);
        if (existingApproval) await tx.releaseApproval.update({ where: { id: existingApproval.id }, data: { stage: input.lifecycle ?? current.lifecycle, reviewedById: input.reviewed ? admin.id : existingApproval.reviewedById, reviewedAt: input.reviewed ? new Date() : existingApproval.reviewedAt, approvedById: input.approve ? admin.id : existingApproval.approvedById, approvedAt: input.approve ? new Date() : existingApproval.approvedAt, notes: input.notes ?? existingApproval.notes } });
        else await tx.releaseApproval.create({ data: { versionId: id, stage: input.lifecycle ?? current.lifecycle, createdById: admin.id, payloadHash: requestedPayloadHash, reviewedById: input.reviewed ? admin.id : undefined, reviewedAt: input.reviewed ? new Date() : undefined, approvedById: input.approve ? admin.id : undefined, approvedAt: input.approve ? new Date() : undefined, notes: input.notes } });
      }
      return updated;
    });
    await audit({ actorId: admin.id, action: input.breakGlass ? "RELEASE_BREAK_GLASS_USED" : "RELEASE_LIFECYCLE_CHANGED", targetType: "ProductVersion", targetId: id, metadata: { lifecycle: input.lifecycle, approved: Boolean(input.approve), reviewed: Boolean(input.reviewed), notes: input.notes ?? "", justification: input.breakGlassJustification ?? "" } }); return NextResponse.json(version);
  } catch (e) { return apiError(e); }
}
