import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { audit } from "@/v2/apps/web/audit";
import { requireRecentAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/v2/apps/web/http/api-error";
import { assertSameOrigin } from "@/v2/apps/web/http/request";
import { storageCleanupIdempotencyKey } from "@/lib/storage-cleanup";

export async function PATCH() {
  return NextResponse.json({ error: "DIRECT_ARTIFACT_UPLOAD_REQUIRED", uploadEndpoint: "POST /api/admin/versions/:id/artifacts/uploads" }, { status: 410 });
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
    await audit({ actorId: admin.id, action: "ARTIFACT_REMOVED", targetType: "ProductArtifact", targetId: id, metadata: { cleanupPending: true } });
    return NextResponse.json({ ok: true, cleanupPending: true });
  } catch (error) { return apiError(error); }
}
