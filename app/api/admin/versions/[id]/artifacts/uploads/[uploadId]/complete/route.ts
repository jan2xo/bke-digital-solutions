import { NextResponse } from "next/server";
import { requireRecentAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { apiError } from "@/v2/apps/web/http/api-error";
import { assertSameOrigin } from "@/v2/apps/web/http/request";
import { deleteObject } from "@/lib/storage";
import { verifyStoredArtifact } from "@/lib/artifacts/verify-stored-artifact";
import { queueStorageCleanup } from "@/lib/storage-cleanup";
import { ensureCommissioningRun } from "@/lib/commissioning/service";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; uploadId: string }> }) {
  let session: { id: string; objectKey: string; productId: string; versionId: string; createdById: string; state: string; expiresAt: Date; expectedSize: bigint; expectedSha256: string | null; contentType: string; originalFilename: string } | null = null;
  try {
    assertSameOrigin(request);
    const admin = await requireRecentAdmin();
    const { id: versionId, uploadId } = await params;
    session = await db.artifactUploadSession.findUniqueOrThrow({ where: { id: uploadId }, select: { id: true, objectKey: true, productId: true, versionId: true, createdById: true, state: true, expiresAt: true, expectedSize: true, expectedSha256: true, contentType: true, originalFilename: true } });
    if (session.versionId !== versionId) throw new Error("UPLOAD_VERSION_MISMATCH");
    if (session.createdById !== admin.id) throw new Error("UPLOAD_NOT_OWNER");
    if (session.state === "VERIFIED") {
      const existing = await db.productArtifact.findFirst({ where: { objectKey: session.objectKey, versionId } });
      if (existing) return NextResponse.json({ uploadId: session.id, state: "VERIFIED", artifactId: existing.id, objectKey: existing.objectKey, sha256: existing.sha256, sizeBytes: Number(existing.sizeBytes), idempotent: true });
      throw new Error("UPLOAD_ALREADY_COMPLETED");
    }
    if (session.state === "FAILED" || session.state === "EXPIRED") throw new Error("UPLOAD_NOT_ACTIVE");
    if (session.expiresAt.getTime() <= Date.now()) {
      await db.artifactUploadSession.update({ where: { id: session.id }, data: { state: "EXPIRED", failedAt: new Date(), failureReason: "EXPIRED" } });
      throw new Error("UPLOAD_EXPIRED");
    }

    const updated = await db.artifactUploadSession.updateMany({ where: { id: session.id, state: "PENDING" }, data: { state: "VERIFYING" } });
    if (updated.count !== 1) throw new Error("UPLOAD_COMPLETION_CONFLICT");
    const verified = await verifyStoredArtifact({ objectKey: session.objectKey, expectedSize: Number(session.expectedSize), expectedSha256: session.expectedSha256, contentType: session.contentType });
    const artifact = await db.$transaction(async (tx) => {
      const version = await tx.productVersion.findUniqueOrThrow({ where: { id: versionId }, include: { artifacts: true, supplyChainEvidence: true } });
      const created = await tx.productArtifact.create({ data: { productId: session!.productId, versionId, name: session!.originalFilename, objectKey: session!.objectKey, sha256: verified.sha256, sizeBytes: verified.sizeBytes, contentType: verified.contentType, active: true } });
      if (version.supplyChainEvidence) await tx.supplyChainEvidence.update({ where: { versionId }, data: { manifestJson: { artifacts: [...version.artifacts, created].map((item) => ({ id: item.id, name: item.name, objectKey: item.objectKey, sha256: item.sha256, sizeBytes: Number(item.sizeBytes), contentType: item.contentType })) }, sbomReference: null, provenanceStatus: "RECORDED", dependencyVerified: false, signatureVerified: false, manifestSignature: null, canonicalPayloadHash: null, signatureKeyId: null, signatureAlgorithm: null, signedAt: null, malwareStatus: "CLEAN" } });
      await tx.artifactUploadSession.update({ where: { id: session!.id }, data: { state: "VERIFIED", completedAt: new Date() } });
      return created;
    });
    await audit({ actorId: admin.id, action: "ARTIFACT_UPLOAD_COMPLETED", targetType: "ProductVersion", targetId: versionId, metadata: { uploadId: session.id, artifactId: artifact.id, sha256: verified.sha256, objectSize: verified.sizeBytes, malware: verified.malware.scannerId } });
    await ensureCommissioningRun(artifact.id);
    return NextResponse.json({ uploadId: session.id, state: "VERIFIED", artifactId: artifact.id, objectKey: session.objectKey, sha256: verified.sha256, sizeBytes: verified.sizeBytes });
  } catch (error) {
    if (session && !["UPLOAD_ALREADY_COMPLETED", "UPLOAD_COMPLETION_CONFLICT", "UPLOAD_VERSION_MISMATCH", "UPLOAD_NOT_OWNER"].some((code) => error instanceof Error && error.message === code)) {
      await db.artifactUploadSession.updateMany({ where: { id: session.id, state: { in: ["PENDING", "VERIFYING"] } }, data: { state: "FAILED", failedAt: new Date(), failureReason: error instanceof Error ? error.message : "UPLOAD_FAILED" } }).catch(() => undefined);
      await deleteObject(session.objectKey).catch(async () => { await queueStorageCleanup({ type: "ABANDONED_UPLOAD", targetType: "ArtifactUploadSession", targetId: session!.id, objectKey: session!.objectKey, productId: session!.productId, actorId: session!.createdById }); });
    }
    return apiError(error);
  }
}
