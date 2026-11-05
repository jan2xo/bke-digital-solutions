import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { audit } from "@/apps/web/audit";
import { requireAdmin } from "@/apps/web/auth/session";
import { apiError } from "@/apps/web/http/api-error";
import { assertSameOrigin } from "@/apps/web/http/request";
import { db } from "@/platform/host/db";
import { isLegacyProductImageObjectKey, resolveProductImageUrl } from "@/apps/web/catalog/product-image";
import { storageCleanupIdempotencyKey } from "@/apps/web/storage/cleanup";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const { id } = await params;
    const body: unknown = await request.json();
    const url = body && typeof body === "object" && "url" in body
      ? resolveProductImageUrl((body as { url?: unknown }).url)
      : null;
    if (!url) throw new Error("INVALID_IMAGE_URL");
    const cleanupPending = await db.$transaction(async (tx) => {
      const current = await tx.product.findUniqueOrThrow({ where: { id }, select: { imageKey: true } });
      await tx.product.update({ where: { id }, data: { imageKey: url } });
      const cleanupPending = isLegacyProductImageObjectKey(current.imageKey, id);
      if (cleanupPending) {
        const idempotencyKey = storageCleanupIdempotencyKey("ARTIFACT_REPLACEMENT", id, current.imageKey);
        await tx.storageCleanupJob.upsert({
          where: { idempotencyKey }, update: {},
          create: {
            type: "ARTIFACT_REPLACEMENT", targetType: "ProductImage", targetId: id,
            objectKey: current.imageKey, idempotencyKey, correlationId: randomUUID(),
            productId: id, createdByAdminId: admin.id,
          },
        });
      }
      return cleanupPending;
    });
    await audit({ actorId: admin.id, action: "PRODUCT_IMAGE_UPDATED", targetType: "Product", targetId: id, metadata: { source: "github", cleanupPending } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
