import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { apiError } from "@/v2/apps/web/http/api-error";
import { downloadObject, uploadObject, deleteObject } from "@/lib/storage";
import { validateReleaseEvidence, bearerMatches } from "@/lib/supply-chain/release-evidence";

export async function POST(request: Request) {
  const uploaded: string[] = [];
  try {
    if (!bearerMatches(request.headers.get("authorization"), env.RELEASE_EVIDENCE_INGESTION_TOKEN)) throw new Error("UNAUTHORIZED");
    const envelope = validateReleaseEvidence(await request.json());
    const version = await db.productVersion.findFirst({ where: { version: envelope.version, product: { productId: envelope.productId } }, include: { product: true, artifacts: true, supplyChainEvidence: { include: { verificationEvidence: true } } } });
    if (!version) throw new Error("UNKNOWN_PRODUCT_VERSION");
    if (version.product.productId !== envelope.productId) throw new Error("PRODUCT_ID_MISMATCH");
    if (version.productId !== version.product.id) throw new Error("VERSION_PRODUCT_MISMATCH");
    const manifest = envelope.manifest as { productId?: unknown; version?: unknown; sourceSha?: unknown };
    if (manifest.productId !== envelope.productId || manifest.version !== envelope.version || manifest.sourceSha !== envelope.sourceSha) throw new Error("SOURCE_IDENTITY_MISMATCH");
    if (!env.RELEASE_EVIDENCE_TRUSTED_REPOSITORY || !env.RELEASE_EVIDENCE_TRUSTED_WORKFLOW || envelope.producer.repository !== env.RELEASE_EVIDENCE_TRUSTED_REPOSITORY || envelope.producer.workflow !== env.RELEASE_EVIDENCE_TRUSTED_WORKFLOW) throw new Error("UNTRUSTED_PRODUCER");
    const existing = version.supplyChainEvidence;
    if (!existing) throw new Error("SUPPLY_CHAIN_EVIDENCE_NOT_INITIALIZED");
    if (version.artifacts.length !== envelope.artifacts.length || version.artifacts.some((current) => {
      const incoming = envelope.artifacts.find((item) => item.id === current.id);
      return !incoming || !current.active || current.sha256 !== incoming.sha256 || Number(current.sizeBytes) !== incoming.sizeBytes || current.objectKey !== incoming.objectKey;
    })) throw new Error("ARTIFACT_METADATA_MISMATCH");
    for (const artifact of version.artifacts) {
      const canonical = await downloadObject(artifact.objectKey);
      if (canonical.length !== Number(artifact.sizeBytes) || createHash("sha256").update(canonical).digest("hex") !== artifact.sha256) throw new Error("CANONICAL_ARTIFACT_MISMATCH");
      const submitted = envelope.artifacts.find((item) => item.id === artifact.id);
      if (!submitted || submitted.objectKey !== artifact.objectKey || submitted.sha256 !== artifact.sha256 || submitted.sizeBytes !== Number(artifact.sizeBytes)) throw new Error("ARTIFACT_METADATA_MISMATCH");
    }
    const currentEvidence = existing.verificationEvidence;
    for (const item of envelope.evidence) {
      const same = currentEvidence.find((row) => row.kind === item.kind && row.artifactHash === envelope.manifestSha256 && row.documentSha256 === item.documentSha256 && row.result === "VERIFIED");
      const conflict = currentEvidence.some((row) => row.kind === item.kind && row.artifactHash === envelope.manifestSha256 && row.documentSha256 !== item.documentSha256 && row.result === "VERIFIED");
      if (conflict) throw new Error("CONFLICTING_EVIDENCE");
      if (!same) continue;
    }
    const allAlreadyPresent = envelope.evidence.every((item) => currentEvidence.some((row) => row.kind === item.kind && row.artifactHash === envelope.manifestSha256 && row.documentSha256 === item.documentSha256 && row.result === "VERIFIED"));
    if (allAlreadyPresent) return NextResponse.json({ ok: true, idempotent: true, idempotencyKey: `${envelope.productId}:${envelope.version}:${envelope.manifestSha256}` });
    try {
      await db.$transaction(async (tx) => {
        for (const item of envelope.evidence) {
          const objectKey = `evidence/${version.id}/ingested/${item.kind.toLowerCase()}/${randomUUID()}`; const bytes = Buffer.from(item.documentBase64, "base64"); await uploadObject(objectKey, bytes, "application/json"); uploaded.push(objectKey);
          await tx.supplyChainVerificationEvidence.create({ data: { evidenceId: existing.id, kind: item.kind, artifactHash: envelope.manifestSha256, result: "VERIFIED", reference: item.reference, documentObjectKey: objectKey, documentSha256: item.documentSha256, metadata: { sourceSha: envelope.sourceSha, producer: envelope.producer } } });
        }
        await tx.supplyChainEvidence.update({ where: { id: existing.id }, data: { sbomReference: envelope.evidence.find((x) => x.kind === "SBOM")?.reference, provenanceStatus: "VERIFIED", dependencyVerified: true } });
        await tx.productVersion.update({ where: { id: version.id }, data: { migrationEvidence: envelope.evidence.find((x) => x.kind === "MIGRATION")?.reference } });
        await tx.auditLog.create({ data: { action: "RELEASE_EVIDENCE_INGESTED", targetType: "ProductVersion", targetId: version.id, metadata: { productId: envelope.productId, version: envelope.version, sourceSha: envelope.sourceSha, manifestSha256: envelope.manifestSha256, producer: envelope.producer } } });
      });
    } catch (error) {
      const cleanup = await Promise.allSettled(uploaded.map((key) => deleteObject(key)));
      const failed = cleanup.filter((result) => result.status === "rejected");
      if (failed.length > 0) console.error("RELEASE_EVIDENCE_CLEANUP_FAILED", { count: failed.length });
      throw error;
    }
    return NextResponse.json({ ok: true, idempotencyKey: `${envelope.productId}:${envelope.version}:${envelope.manifestSha256}` });
  } catch (error) { return apiError(error); }
}
