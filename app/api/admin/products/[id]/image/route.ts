import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security/request";
import { deleteObject, uploadObject } from "@/lib/storage";
import { queueStorageCleanup, storageCleanupIdempotencyKey } from "@/lib/storage-cleanup";

const allowed = new Set([".png", ".jpg", ".jpeg", ".webp"]);
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let uploaded: { objectKey: string; productId: string; actorId: string } | null = null;
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const { id } = await params;
    const form = await request.formData();
    const file = form.get("image");
    if (!(file instanceof File) || file.size < 1 || file.size > 5 * 1024 * 1024) throw new Error("INVALID_FILE_SIZE");
    const ext = extname(file.name).toLowerCase();
    if (!allowed.has(ext)) throw new Error("INVALID_FILE_TYPE");
    const key = `products/${id}/images/${randomUUID()}${ext}`;
    await uploadObject(key, new Uint8Array(await file.arrayBuffer()), file.type || "application/octet-stream");
    uploaded = { objectKey: key, productId: id, actorId: admin.id };
    await db.$transaction(async (tx) => {
      const current = await tx.product.findUniqueOrThrow({ where: { id }, select: { imageKey: true } });
      await tx.product.update({ where: { id }, data: { imageKey: key } });
      if (current.imageKey) {
        const idempotencyKey = storageCleanupIdempotencyKey("ARTIFACT_REPLACEMENT", id, current.imageKey);
        await tx.storageCleanupJob.upsert({ where: { idempotencyKey }, update: {}, create: { type: "ARTIFACT_REPLACEMENT", targetType: "ProductImage", targetId: id, objectKey: current.imageKey, idempotencyKey, correlationId: randomUUID(), productId: id, createdByAdminId: admin.id } });
      }
    });
    uploaded = null;
    await audit({ actorId: admin.id, action: "PRODUCT_IMAGE_UPDATED", targetType: "Product", targetId: id, metadata: { sizeBytes: file.size, contentType: file.type, cleanupPending: true } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (uploaded) await deleteObject(uploaded.objectKey).catch(() => queueStorageCleanup({ type: "ABANDONED_UPLOAD", targetType: "ProductImageUpload", targetId: randomUUID(), objectKey: uploaded!.objectKey, productId: uploaded!.productId, actorId: uploaded!.actorId }));
    return apiError(error);
  }
}
