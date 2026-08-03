import { createHash, randomUUID } from "node:crypto";
import { extname } from "node:path";
import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { requireRecentAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { apiError } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security/request";
import { deleteObject, uploadObject } from "@/lib/storage";
import { queueStorageCleanup, storageCleanupIdempotencyKey } from "@/lib/storage-cleanup";

const allowed = new Set([".dmg", ".pkg", ".exe", ".msi", ".zip", ".deb", ".rpm", ".appimage"]);
const MAX = env.MAX_ARTIFACT_BYTES;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const admin = await requireRecentAdmin();
    const { id } = await params;
    const form = await request.formData();
    const file = form.get("installer");
    if (!(file instanceof File) || file.size < 1 || file.size > MAX) throw new Error("INVALID_FILE_SIZE");
    const ext = extname(file.name).toLowerCase();
    if (!allowed.has(ext)) throw new Error("INVALID_FILE_TYPE");
    const current = await db.productArtifact.findUniqueOrThrow({ where: { id } });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const objectKey = `products/${current.productId}/replacements/${randomUUID()}${ext}`;
    await uploadObject(objectKey, bytes, file.type || "application/octet-stream");
    let artifact;
    try {
      artifact = await db.$transaction(async (tx) => {
        const updated = await tx.productArtifact.update({ where: { id }, data: { name: file.name, objectKey, sha256, sizeBytes: file.size, contentType: file.type || "application/octet-stream", active: true, removedAt: null } });
        const idempotencyKey = storageCleanupIdempotencyKey("ARTIFACT_REPLACEMENT", id, current.objectKey);
        await tx.storageCleanupJob.upsert({ where: { idempotencyKey }, update: {}, create: { type: "ARTIFACT_REPLACEMENT", targetType: "ProductArtifact", targetId: id, objectKey: current.objectKey, idempotencyKey, correlationId: randomUUID(), productId: current.productId, artifactId: id, createdByAdminId: admin.id } });
        await tx.auditLog.create({ data: { actorId: admin.id, action: "ARTIFACT_CLEANUP_QUEUED", targetType: "ProductArtifact", targetId: id, metadata: { reason: "REPLACEMENT" } } });
        return updated;
      });
    } catch (error) {
      await deleteObject(objectKey).catch(async () => { await queueStorageCleanup({ type: "ABANDONED_UPLOAD", targetType: "ProductArtifact", targetId: id, objectKey, productId: current.productId, actorId: admin.id }); });
      throw error;
    }
    await audit({ actorId: admin.id, action: "ARTIFACT_REPLACED", targetType: "ProductArtifact", targetId: id, metadata: { sha256, sizeBytes: file.size, cleanupPending: true } });
    return NextResponse.json({ id: artifact.id, sha256, cleanupPending: true });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const admin = await requireRecentAdmin();
    const { id } = await params;
    const current = await db.productArtifact.findUniqueOrThrow({ where: { id } });
    await db.$transaction(async (tx) => {
      await tx.productArtifact.update({ where: { id }, data: { active: false, removedAt: new Date() } });
      const idempotencyKey = storageCleanupIdempotencyKey("ARTIFACT_REMOVAL", id, current.objectKey);
      await tx.storageCleanupJob.upsert({ where: { idempotencyKey }, update: {}, create: { type: "ARTIFACT_REMOVAL", targetType: "ProductArtifact", targetId: id, objectKey: current.objectKey, idempotencyKey, correlationId: randomUUID(), productId: current.productId, artifactId: id, createdByAdminId: admin.id } });
      await tx.auditLog.create({ data: { actorId: admin.id, action: "ARTIFACT_CLEANUP_QUEUED", targetType: "ProductArtifact", targetId: id, metadata: { reason: "REMOVAL" } } });
    });
    return NextResponse.json({ ok: true, cleanupPending: true });
  } catch (error) { return apiError(error); }
}
