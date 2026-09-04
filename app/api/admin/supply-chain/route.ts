import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin, requireRecentAdmin } from "@/lib/auth";
import { apiError } from "@/v2/apps/web/http/api-error";
import { assertSameOrigin, clientIp } from "@/v2/apps/web/http/request";
import { rateLimit } from "@/v2/apps/web/http/rate-limit";
import { env } from "@/lib/env";
import { scanArtifactStream } from "@/lib/supply-chain/scanner";
import { resolveTrustedSupplyChainKey } from "@/lib/supply-chain/keyring";
import { signReleaseManifest } from "@/lib/supply-chain/signing";
import { buildReleaseManifest, canonicalizeManifest, manifestHash } from "@/lib/supply-chain/manifest";
import { assertObjectExists, streamObject, uploadObject } from "@/v2/apps/web/storage/object-storage";
import { buildBackupCertificationDocument, selectUniqueVerifiedBackup } from "@/lib/supply-chain/backup-certification";
import { validateComplianceCertification } from "@/lib/supply-chain/compliance-certification";
import { CHECKOUT_LEGAL_TYPES, SUBSCRIPTION_LEGAL_TYPES, REGISTRATION_LEGAL_TYPES } from "@/lib/legal/constants";
import { integrityEvidencePlan } from "@/lib/supply-chain/integrity";
import { validateTechnicalEvidence } from "@/lib/supply-chain/technical-evidence";

const schema = z.object({ versionId: z.string().min(1), backupId: z.string().min(1).optional(), action: z.enum(["SIGN", "RECORD_SCAN", "RECORD_SBOM", "RECORD_PROVENANCE", "RECORD_DEPENDENCIES", "RECORD_BACKUP", "CERTIFY_BACKUP", "CERTIFY_COMPLIANCE", "RECORD_COMPLIANCE", "RECORD_MIGRATION", "VERIFY_SIGNATURE", "QUARANTINE", "RESCAN", "EMERGENCY_REVOKE", "MARK_COMPROMISED"]).optional(), signature: z.string().min(16).optional(), signerKeyId: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/).optional(), reference: z.string().trim().min(1).max(512).optional(), documentBase64: z.string().max(14_000_000).optional(), evidenceHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), reason: z.string().trim().min(8).max(2000).optional(), scope: z.string().trim().max(2000).optional(), attestation: z.literal(true).optional(), notes: z.string().trim().max(2000).optional() });
function publicKey(keyId: string) { const resolved = resolveTrustedSupplyChainKey(env.SUPPLY_CHAIN_TRUSTED_KEYS, env.SUPPLY_CHAIN_SIGNING_KEY_ID, env.SUPPLY_CHAIN_SIGNING_PUBLIC_KEY, keyId); const raw = resolved.key.includes("BEGIN") ? resolved.key : Buffer.from(resolved.key, "base64").toString("utf8"); return createPublicKey(raw); }
function validateEvidenceDocument(kind: string, document: Buffer) {
  const text = document.toString("utf8");
  if (kind === "MIGRATION" && !/database schema is up to date/i.test(text)) throw new Error("MIGRATION_EVIDENCE_NOT_CURRENT");
}

export async function GET() { try { await requireAdmin(); const rows = await db.supplyChainEvidence.findMany({ include: { verificationEvidence: true, version: { include: { product: { select: { name: true } }, artifacts: { select: { name: true, sha256: true, sizeBytes: true } } } } }, orderBy: { builtAt: "desc" } }); return NextResponse.json(rows.map((row) => ({ ...row, version: { ...row.version, artifacts: row.version.artifacts.map((artifact) => ({ ...artifact, sizeBytes: artifact.sizeBytes.toString() })) } }))); } catch (e) { return apiError(e); } }

export async function POST(request: Request) {
  try {
    assertSameOrigin(request); const admin = await requireRecentAdmin();
    const limited = await rateLimit(`admin-supply-chain:${admin.id}:${clientIp(request)}`, 30, 3600); if (!limited.allowed) throw new Error("RATE_LIMITED");
    const input = schema.parse(await request.json());
    const existing = await db.supplyChainEvidence.findUnique({ where: { versionId: input.versionId }, include: { version: { include: { product: true, artifacts: true } }, verificationEvidence: true } });
    if (!existing) throw new Error("NOT_FOUND");
    if (input.action === "CERTIFY_BACKUP") {
      const candidates = input.backupId
        ? [await db.backupArchive.findUnique({ where: { id: input.backupId }, include: { operations: { orderBy: { createdAt: "asc" } } } })].filter((item): item is NonNullable<typeof item> => Boolean(item))
        : await db.backupArchive.findMany({ where: { status: "VERIFIED", missingObjectCount: 0 }, include: { operations: { orderBy: { createdAt: "asc" } } }, orderBy: { verifiedAt: "desc" } });
      const archive = selectUniqueVerifiedBackup(existing.version, candidates);
      const generated = buildBackupCertificationDocument(existing.version, archive);
      const prior = existing.verificationEvidence.find((item) => item.kind === "BACKUP" && item.artifactHash === generated.payloadBinding && item.documentSha256 === generated.documentSha256 && item.result === "VERIFIED");
      const objectKey = prior?.documentObjectKey ?? `evidence/${existing.version.id}/backup/${randomUUID()}.json`;
      if (!prior) { await uploadObject(objectKey, Buffer.from(generated.serialized), "application/json"); await assertObjectExists(objectKey); }
      await db.$transaction(async (tx) => {
        const metadata = { payloadHash: generated.payloadBinding, documentSha256: generated.documentSha256, backupId: input.backupId };
        if (prior) await tx.supplyChainVerificationEvidence.update({ where: { id: prior.id }, data: { reference: objectKey, documentObjectKey: objectKey, documentSha256: generated.documentSha256, metadata, result: "VERIFIED", failureReason: null } });
        else await tx.supplyChainVerificationEvidence.create({ data: { evidenceId: existing.id, kind: "BACKUP", artifactHash: generated.payloadBinding, result: "VERIFIED", reference: objectKey, documentObjectKey: objectKey, documentSha256: generated.documentSha256, metadata } });
        await tx.productVersion.update({ where: { id: existing.version.id }, data: { backupEvidence: objectKey } });
        await tx.auditLog.create({ data: { actorId: admin.id, action: "SUPPLY_CHAIN_BACKUP_RECORDED", targetType: "SupplyChainEvidence", targetId: existing.id, metadata } });
      });
      return NextResponse.json({ ok: true, status: "VERIFIED", kind: "BACKUP", payloadHash: generated.payloadBinding });
    }
    const signedManifest = buildReleaseManifest({ productId: existing.version.productId, productSlug: existing.version.product.slug, versionId: existing.version.id, version: existing.version.version, signingKeyId: env.SUPPLY_CHAIN_SIGNING_KEY_ID, artifacts: existing.version.artifacts.map((a) => ({ id: a.id, objectKey: a.objectKey, sha256: a.sha256, sizeBytes: Number(a.sizeBytes), contentType: a.contentType })) });
    const canonicalPayloadHash = manifestHash(canonicalizeManifest(signedManifest));
    if (input.action === "CERTIFY_COMPLIANCE") {
      if (input.attestation !== true) throw new Error("COMPLIANCE_ATTESTATION_REQUIRED");
      const product = await db.product.findUnique({ where: { id: existing.version.productId }, include: { editions: { include: { purchasePlans: { where: { active: true }, select: { type: true } } } } } });
      if (!product) throw new Error("NOT_FOUND");
      const requiredTypes = [...REGISTRATION_LEGAL_TYPES, ...CHECKOUT_LEGAL_TYPES, ...(product.editions.some((edition) => edition.purchasePlans.some((plan) => plan.type === "MONTHLY" || plan.type === "ANNUAL")) ? SUBSCRIPTION_LEGAL_TYPES : [])];
      const legalDocuments = await db.legalDocument.findMany({ where: { status: "ACTIVE", documentType: { in: requiredTypes }, currentPublishedVersionId: { not: null } }, include: { currentPublishedVersion: true } });
      if (legalDocuments.length !== new Set(requiredTypes).size || legalDocuments.some((document) => !document.currentPublishedVersion || document.currentPublishedVersion.status !== "PUBLISHED")) throw new Error("COMPLIANCE_LEGAL_DOCUMENTS_UNAVAILABLE");
      const evidence = { format: "bke.compliance-certification.v1", classification: "COMMERCIAL", versionId: existing.version.id, releaseVersion: existing.version.version, payloadHash: canonicalPayloadHash, scope: input.scope, legalDocuments: legalDocuments.map((document) => ({ type: document.documentType, versionId: document.currentPublishedVersion!.id, contentHash: document.currentPublishedVersion!.contentHash })), assertions: { legalReviewed: true, privacyReviewed: true, taxReviewed: true, retentionDecided: true }, reviewers: [{ role: admin.role, identity: admin.email }], certifyingAdmin: { id: admin.id }, notes: input.notes ?? null, certifiedAt: new Date().toISOString() };
      const serialized = JSON.stringify(evidence, null, 2) + "\n";
      const documentSha256 = createHash("sha256").update(serialized).digest("hex");
      const prior = existing.verificationEvidence.find((item) => item.kind === "COMPLIANCE" && item.result === "VERIFIED" && item.artifactHash === canonicalPayloadHash && typeof item.metadata === "object" && item.metadata && (item.metadata as { certifyingAdmin?: { id?: string } }).certifyingAdmin?.id === admin.id && (item.metadata as { scope?: string }).scope === input.scope);
      const objectKey = prior?.documentObjectKey ?? `evidence/${existing.version.id}/compliance/${randomUUID()}.json`;
      if (!prior) { await uploadObject(objectKey, Buffer.from(serialized), "application/json"); await assertObjectExists(objectKey); }
      const validated = validateComplianceCertification(Buffer.from(serialized), existing.version.id, canonicalPayloadHash);
      await db.$transaction(async (tx) => {
        const metadata = { ...validated, documentObjectKey: objectKey, documentSha256, certifyingAdminId: admin.id, certifyingAdminRole: admin.role, certifyingAdminEmail: admin.email, scope: input.scope };
        if (prior) await tx.supplyChainVerificationEvidence.update({ where: { id: prior.id }, data: { documentObjectKey: objectKey, documentSha256, metadata, result: "VERIFIED" } });
        else await tx.supplyChainVerificationEvidence.create({ data: { evidenceId: existing.id, kind: "COMPLIANCE", artifactHash: canonicalPayloadHash, result: "VERIFIED", reference: objectKey, documentObjectKey: objectKey, documentSha256, metadata } });
        await tx.productVersion.update({ where: { id: existing.version.id }, data: { complianceEvidence: objectKey } });
        await tx.auditLog.create({ data: { actorId: admin.id, action: "SUPPLY_CHAIN_COMPLIANCE_CERTIFIED", targetType: "SupplyChainEvidence", targetId: existing.id, metadata: { payloadHash: canonicalPayloadHash, certifyingAdminId: admin.id, certifyingAdminRole: admin.role, scope: input.scope, legalVersionIds: validated.legalDocuments.map((item) => item.versionId) } } });
      });
      return NextResponse.json({ ok: true, status: "VERIFIED", kind: "COMPLIANCE", payloadHash: canonicalPayloadHash, legalVersionCount: validated.legalDocuments.length });
    }
    if (["RECORD_SBOM", "RECORD_PROVENANCE", "RECORD_DEPENDENCIES", "RECORD_BACKUP", "RECORD_COMPLIANCE", "RECORD_MIGRATION"].includes(input.action ?? "")) {
      if (!input.reference) throw new Error("EVIDENCE_REFERENCE_REQUIRED");
      if (!input.documentBase64) throw new Error("EVIDENCE_DOCUMENT_REQUIRED");
      if (input.evidenceHash && input.evidenceHash !== canonicalPayloadHash) throw new Error("EVIDENCE_HASH_MISMATCH");
      let document: Buffer;
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input.documentBase64) || input.documentBase64.length % 4 === 1) throw new Error("EVIDENCE_DOCUMENT_INVALID");
      try { document = Buffer.from(input.documentBase64, "base64"); } catch { throw new Error("EVIDENCE_DOCUMENT_INVALID"); }
      if (!document.length) throw new Error("EVIDENCE_DOCUMENT_INVALID");
      const documentSha256 = createHash("sha256").update(document).digest("hex");
      if (/^(?:file:|[A-Za-z]:[\\/]|\/|\.\.?\/|.*(?:^|\/)tmp(?:\/|$)|.*(?:^|\/)\.supply-chain(?:\/|$))/i.test(input.reference)) throw new Error("EVIDENCE_REFERENCE_NOT_DURABLE");
      const kind = input.action === "RECORD_SBOM" ? "SBOM" : input.action === "RECORD_PROVENANCE" ? "PROVENANCE" : input.action === "RECORD_DEPENDENCIES" ? "DEPENDENCIES" : input.action === "RECORD_BACKUP" ? "BACKUP" : input.action === "RECORD_COMPLIANCE" ? "COMPLIANCE" : "MIGRATION";
      if (["SBOM", "PROVENANCE", "DEPENDENCIES"].includes(kind)) validateTechnicalEvidence(kind, document, existing.version.version);
      else validateEvidenceDocument(kind, document);
      const compliance = kind === "COMPLIANCE" ? validateComplianceCertification(document, existing.version.id, canonicalPayloadHash) : null;
      if (compliance?.classification === "COMMERCIAL") {
        const legalVersions = await db.legalDocumentVersion.findMany({ where: { id: { in: compliance.legalDocuments.map((item) => item.versionId) }, status: "PUBLISHED" }, include: { currentForDocument: { select: { currentPublishedVersionId: true, documentType: true } } } });
        if (legalVersions.length !== compliance.legalDocuments.length || compliance.legalDocuments.some((item) => !legalVersions.some((version) => version.id === item.versionId && version.contentHash === item.contentHash && version.currentForDocument?.currentPublishedVersionId === version.id && version.currentForDocument.documentType === item.type))) throw new Error("COMPLIANCE_LEGAL_REFERENCE_INVALID");
      }
      const evidenceResult = compliance?.classification === "MOCK" ? "MOCK" : "VERIFIED";
      const prior = existing.verificationEvidence.find((item) => item.kind === kind && item.artifactHash === canonicalPayloadHash && item.documentSha256 === documentSha256 && item.result === "VERIFIED");
      const objectKey = prior?.documentObjectKey ?? `evidence/${existing.version.id}/${kind.toLowerCase()}/${randomUUID()}.json`;
      if (!prior) { await uploadObject(objectKey, document, "application/json"); await assertObjectExists(objectKey); }
      await db.$transaction(async (tx) => {
        const metadata = { reference: input.reference, documentSha256, ...(compliance ?? { classification: "STANDARD" }), payloadHash: canonicalPayloadHash };
        if (prior) await tx.supplyChainVerificationEvidence.update({ where: { id: prior.id }, data: { result: evidenceResult, reference: input.reference, failureReason: null, metadata, documentObjectKey: objectKey, documentSha256 } });
        else await tx.supplyChainVerificationEvidence.create({ data: { evidenceId: existing.id, kind, artifactHash: canonicalPayloadHash, result: evidenceResult, reference: input.reference, documentObjectKey: objectKey, documentSha256, metadata: { ...metadata, classification: compliance?.classification ?? "STANDARD" } } });
        await tx.supplyChainEvidence.update({ where: { id: existing.id }, data: kind === "SBOM" ? { sbomReference: input.reference } : kind === "PROVENANCE" ? { provenanceStatus: "VERIFIED" } : kind === "DEPENDENCIES" ? { dependencyVerified: true } : {} });
        if (kind !== "SBOM" && kind !== "PROVENANCE" && kind !== "DEPENDENCIES" && kind !== "COMPLIANCE" || (kind === "COMPLIANCE" && evidenceResult === "VERIFIED")) await tx.productVersion.update({ where: { id: existing.version.id }, data: kind === "BACKUP" ? { backupEvidence: input.reference } : kind === "COMPLIANCE" ? { complianceEvidence: input.reference } : { migrationEvidence: input.reference } });
        await tx.auditLog.create({ data: { actorId: admin.id, action: `SUPPLY_CHAIN_${kind}_RECORDED`, targetType: "SupplyChainEvidence", targetId: existing.id, metadata: { payloadHash: canonicalPayloadHash, reference: input.reference } } });
      });
      return NextResponse.json({ ok: true, status: evidenceResult, kind, payloadHash: canonicalPayloadHash });
    }
    if (input.action === "SIGN") {
      const signed = signReleaseManifest({ productId: existing.version.productId, productSlug: existing.version.product.slug, versionId: existing.version.id, version: existing.version.version, artifacts: existing.version.artifacts.map((a) => ({ id: a.id, objectKey: a.objectKey, sha256: a.sha256, sizeBytes: Number(a.sizeBytes), contentType: a.contentType })) });
      const priorSignature = existing.verificationEvidence.find((v) => v.kind === "SIGNATURE" && v.result === "VERIFIED" && v.artifactHash === signed.payloadHash && v.signerKeyId === signed.keyId);
      const priorChecksum = existing.verificationEvidence.find((v) => v.kind === "CHECKSUM" && v.result === "VERIFIED" && v.artifactHash === signed.payloadHash && v.signerKeyId === signed.keyId);
      const plan = integrityEvidencePlan(Boolean(priorSignature), Boolean(priorChecksum));
      if (plan.createSignature) await db.supplyChainVerificationEvidence.create({ data: { evidenceId: existing.id, kind: "SIGNATURE", artifactHash: signed.payloadHash, signerKeyId: signed.keyId, result: "VERIFIED", reference: signed.canonicalPayload, metadata: { algorithm: signed.algorithm, manifest: signed.manifest } } });
      if (plan.createChecksum) await db.supplyChainVerificationEvidence.create({ data: { evidenceId: existing.id, kind: "CHECKSUM", artifactHash: signed.payloadHash, signerKeyId: signed.keyId, result: "VERIFIED", reference: signed.payloadHash, metadata: { algorithm: "SHA-256", artifacts: signed.manifest.artifacts.map((artifact) => ({ id: artifact.id, sha256: artifact.sha256, sizeBytes: artifact.sizeBytes })) } } });
      if (plan.createSignature) await db.supplyChainEvidence.update({ where: { id: existing.id }, data: { canonicalPayloadHash: signed.payloadHash, signatureAlgorithm: signed.algorithm, signatureKeyId: signed.keyId, signedAt: new Date(), signatureVerified: true, manifestSignature: signed.signature, manifestJson: signed.manifest } });
      await db.auditLog.create({ data: { actorId: admin.id, action: "SUPPLY_CHAIN_SIGNED", targetType: "SupplyChainEvidence", targetId: existing.id, metadata: { keyId: signed.keyId, payloadHash: signed.payloadHash } } });
      return NextResponse.json({ ok: true, status: "VERIFIED", keyId: signed.keyId, algorithm: signed.algorithm, payloadHash: signed.payloadHash });
    }
    if (input.action === "VERIFY_SIGNATURE") {
      if (!input.signature) throw new Error("SIGNATURE_REQUIRED"); const signerKeyId = input.signerKeyId ?? env.SUPPLY_CHAIN_SIGNING_KEY_ID;
      const valid = verify(null, Buffer.from(canonicalPayloadHash), publicKey(signerKeyId), Buffer.from(input.signature, "base64"));
      await db.supplyChainVerificationEvidence.create({ data: { evidenceId: existing.id, kind: "SIGNATURE", artifactHash: canonicalPayloadHash, signerKeyId, result: valid ? "VERIFIED" : "FAILED", failureReason: valid ? undefined : "SIGNATURE_MISMATCH", metadata: { algorithm: "Ed25519" } } });
      if (!valid) throw new Error("SIGNATURE_INVALID"); await db.supplyChainEvidence.update({ where: { id: existing.id }, data: { signatureVerified: true, manifestSignature: input.signature } });
    }
    if (input.action === "RESCAN") input.action = "RECORD_SCAN";
    if (["QUARANTINE", "EMERGENCY_REVOKE", "MARK_COMPROMISED"].includes(input.action ?? "")) {
      if (!input.reason) throw new Error("SUPPLY_CHAIN_REASON_REQUIRED");
      const kind = input.action === "EMERGENCY_REVOKE" ? "EMERGENCY_REVOCATION" : input.action === "MARK_COMPROMISED" ? "COMPROMISE" : "QUARANTINE";
      const result = input.action === "MARK_COMPROMISED" ? "COMPROMISED" : "ACTIVE";
      await db.supplyChainVerificationEvidence.create({ data: { evidenceId: existing.id, kind, artifactHash: canonicalPayloadHash, result, failureReason: input.reason, metadata: { reason: input.reason, actorId: admin.id } } });
      await db.supplyChainEvidence.update({ where: { id: existing.id }, data: input.action === "QUARANTINE" || input.action === "MARK_COMPROMISED" ? { malwareStatus: "INFECTED", signatureVerified: false } : { certificateStatus: "REVOKED", signatureVerified: false } });
      await db.auditLog.create({ data: { actorId: admin.id, action: `SUPPLY_CHAIN_${input.action}`, targetType: "SupplyChainEvidence", targetId: existing.id, metadata: { reason: input.reason, payloadHash: canonicalPayloadHash } } });
      return NextResponse.json({ ok: true, status: result });
    }
    if (input.action === "RECORD_SCAN") {
      const results = [];
      for (const artifact of existing.version.artifacts) {
        let scan;
        try { scan = await scanArtifactStream(await streamObject(artifact.objectKey), Number(artifact.sizeBytes)); }
        catch (error) { scan = { scannerId: env.MALWARE_SCANNER_PROVIDER ?? "storage", scannerVersion: env.MALWARE_SCANNER_VERSION ?? "unknown", result: "FAILED" as const, failureReason: error instanceof Error ? "OBJECT_READ_FAILED" : "OBJECT_READ_FAILED" }; }
        results.push(scan);
        await db.supplyChainVerificationEvidence.create({ data: { evidenceId: existing.id, kind: "MALWARE_SCAN", artifactHash: canonicalPayloadHash, scannerId: scan.scannerId, scannerVersion: scan.scannerVersion, result: scan.result, reference: scan.reference, failureReason: scan.failureReason, metadata: { artifactId: artifact.id, objectKey: artifact.objectKey, artifactSha256: artifact.sha256 } } });
      }
      const aggregate = results.some((r) => r.result === "INFECTED") ? "INFECTED" : results.every((r) => r.result === "CLEAN") ? "CLEAN" : "FAILED";
      await db.supplyChainEvidence.update({ where: { id: existing.id }, data: { malwareStatus: aggregate } }); if (aggregate !== "CLEAN") throw new Error("MALWARE_SCAN_NOT_CLEAN");
    }
    await db.auditLog.create({ data: { actorId: admin.id, action: "SUPPLY_CHAIN_EVIDENCE_UPDATED", targetType: "SupplyChainEvidence", targetId: existing.id, metadata: { action: input.action } } }); return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
