import { NextResponse } from "next/server";
import { requireRecentAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security/request";
import { deleteObject, headObject } from "@/lib/storage";
import { queueStorageCleanup } from "@/lib/storage-cleanup";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; uploadId: string }> }) {
  let session: { id: string; objectKey: string; productId: string; versionId: string; createdById: string; state: string; expiresAt: Date; expectedSize: bigint; contentType: string } | null = null;
  try {
    assertSameOrigin(request);
    const admin = await requireRecentAdmin();
    const { id: versionId, uploadId } = await params;
    session = await db.artifactUploadSession.findUniqueOrThrow({ where: { id: uploadId }, select: { id: true, objectKey: true, productId: true, versionId: true, createdById: true, state: true, expiresAt: true, expectedSize: true, contentType: true } });
    if (session.versionId !== versionId) throw new Error("UPLOAD_VERSION_MISMATCH");
    if (session.createdById !== admin.id) throw new Error("UPLOAD_NOT_OWNER");
    if (session.state === "VERIFIED") throw new Error("UPLOAD_ALREADY_COMPLETED");
    if (session.state === "FAILED" || session.state === "EXPIRED") throw new Error("UPLOAD_NOT_ACTIVE");
    if (session.expiresAt.getTime() <= Date.now()) {
      await db.artifactUploadSession.update({ where: { id: session.id }, data: { state: "EXPIRED", failedAt: new Date(), failureReason: "EXPIRED" } });
      throw new Error("UPLOAD_EXPIRED");
    }

    const object = await headObject(session.objectKey);
    if (object.ContentLength !== Number(session.expectedSize)) throw new Error("UPLOAD_SIZE_MISMATCH");
    if (object.ContentType && object.ContentType !== session.contentType) throw new Error("UPLOAD_CONTENT_TYPE_MISMATCH");
    const updated = await db.artifactUploadSession.updateMany({ where: { id: session.id, state: "PENDING" }, data: { state: "UPLOADED", completedAt: new Date() } });
    if (updated.count !== 1) throw new Error("UPLOAD_COMPLETION_CONFLICT");
    await audit({ actorId: admin.id, action: "ARTIFACT_UPLOAD_COMPLETED", targetType: "ProductVersion", targetId: versionId, metadata: { uploadId: session.id, objectSize: Number(object.ContentLength) } });
    return NextResponse.json({ uploadId: session.id, state: "UPLOADED", objectKey: session.objectKey, verificationRequired: true });
  } catch (error) {
    if (session && !["UPLOAD_ALREADY_COMPLETED", "UPLOAD_COMPLETION_CONFLICT", "UPLOAD_VERSION_MISMATCH", "UPLOAD_NOT_OWNER"].some((code) => error instanceof Error && error.message === code)) {
      await db.artifactUploadSession.updateMany({ where: { id: session.id, state: "PENDING" }, data: { state: "FAILED", failedAt: new Date(), failureReason: error instanceof Error ? error.message : "UPLOAD_FAILED" } }).catch(() => undefined);
      await deleteObject(session.objectKey).catch(async () => { await queueStorageCleanup({ type: "ABANDONED_UPLOAD", targetType: "ArtifactUploadSession", targetId: session!.id, objectKey: session!.objectKey, productId: session!.productId, actorId: session!.createdById }); });
    }
    return apiError(error);
  }
}
