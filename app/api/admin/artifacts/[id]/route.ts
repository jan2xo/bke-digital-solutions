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
      artifact = await db.productArtifact.update({ where: { id }, data: { name: file.name, objectKey, sha256, sizeBytes: file.size, contentType: file.type || "application/octet-stream", active: true, removedAt: null } });
    } catch (error) {
      await deleteObject(objectKey).catch(() => undefined);
      throw error;
    }
    const cleanupFailed = await deleteObject(current.objectKey).then(() => false).catch(() => true);
    await audit({ actorId: admin.id, action: "ARTIFACT_REPLACED", targetType: "ProductArtifact", targetId: id, metadata: { sha256, sizeBytes: file.size, oldObjectKey: "[REDACTED]", cleanupFailed } });
    return NextResponse.json({ id: artifact.id, sha256, cleanupPending: cleanupFailed });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const admin = await requireRecentAdmin();
    const { id } = await params;
    const artifact = await db.productArtifact.update({ where: { id }, data: { active: false, removedAt: new Date() } });
    await audit({ actorId: admin.id, action: "ARTIFACT_REMOVED", targetType: "ProductArtifact", targetId: id, metadata: { productId: artifact.productId } });
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
