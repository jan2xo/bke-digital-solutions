import { createHash, randomUUID } from "node:crypto";
import { extname } from "node:path";
import { NextResponse } from "next/server";
import { requireRecentAdmin } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/security/request";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { apiError } from "@/lib/http";
import { uploadObject, deleteObject } from "@/lib/storage";
import { queueStorageCleanup } from "@/lib/storage-cleanup";
import { audit } from "@/lib/audit";

const allowed = new Set([".dmg", ".pkg", ".exe", ".msi", ".zip", ".deb", ".rpm", ".appimage"]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let uploaded: { objectKey: string; productId: string; actorId: string } | null = null;
  try {
    assertSameOrigin(request);
    const admin = await requireRecentAdmin();
    const { id: versionId } = await params;
    const version = await db.productVersion.findUniqueOrThrow({ where: { id: versionId }, include: { product: true, artifacts: true, supplyChainEvidence: true } });
    const form = await request.formData();
    const file = form.get("installer");
    if (!(file instanceof File) || file.size < 1 || file.size > env.MAX_ARTIFACT_BYTES) throw new Error("INVALID_FILE_SIZE");
    const extension = extname(file.name).toLowerCase();
    if (!allowed.has(extension)) throw new Error("INVALID_FILE_TYPE");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const objectKey = `products/${version.productId}/${version.version}/${randomUUID()}${extension}`;
    await uploadObject(objectKey, bytes, file.type || "application/octet-stream");
    uploaded = { objectKey, productId: version.productId, actorId: admin.id };
    const artifact = await db.$transaction(async (tx) => {
      const created = await tx.productArtifact.create({ data: { productId: version.productId, versionId, name: file.name, objectKey, sha256, sizeBytes: file.size, contentType: file.type || "application/octet-stream", active: true } });
      if (version.supplyChainEvidence) {
        const artifacts = [...version.artifacts, created].map((item) => ({ id: item.id, name: item.name, objectKey: item.objectKey, sha256: item.sha256, sizeBytes: Number(item.sizeBytes), contentType: item.contentType }));
        await tx.supplyChainEvidence.update({ where: { versionId }, data: { manifestJson: { artifacts }, signatureVerified: false, manifestSignature: null, canonicalPayloadHash: null, signatureKeyId: null, signatureAlgorithm: null, signedAt: null, malwareStatus: "PENDING_SCAN" } });
      }
      return created;
    });
    uploaded = null;
    await audit({ actorId: admin.id, action: "ARTIFACT_ADDED", targetType: "ProductVersion", targetId: versionId, metadata: { artifactId: artifact.id, sha256, sizeBytes: file.size } });
    return NextResponse.json({ id: artifact.id, name: artifact.name, sha256, sizeBytes: file.size, contentType: artifact.contentType }, { status: 201 });
  } catch (error) {
    if (uploaded) await deleteObject(uploaded.objectKey).catch(() => queueStorageCleanup({ type: "ABANDONED_UPLOAD", targetType: "ProductArtifact", targetId: randomUUID(), objectKey: uploaded!.objectKey, productId: uploaded!.productId, actorId: uploaded!.actorId }));
    return apiError(error);
  }
}
