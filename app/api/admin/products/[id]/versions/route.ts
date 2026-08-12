import { createHash, randomUUID } from "node:crypto";
import { extname } from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { apiError } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security/request";
import { deleteObject, uploadObject } from "@/lib/storage";
import { queueStorageCleanup } from "@/lib/storage-cleanup";

const fields = z.object({ version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/), releaseNotes: z.string().max(10000).default(""), operatingSystem: z.enum(["Windows", "macOS", "Linux"]), architecture: z.enum(["x64", "arm64", "universal"]), publish: z.enum(["true", "false"]).default("false"), latest: z.enum(["true", "false"]).default("false") });
const allowed = new Set([".exe", ".msi", ".dmg", ".pkg", ".zip", ".deb", ".appimage"]);
const MAX = env.MAX_ARTIFACT_BYTES;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let uploaded: { objectKey: string; productId: string; actorId: string } | null = null;
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const { id } = await params;
    const form = await request.formData();
    const file = form.get("installer");
    if (!(file instanceof File)) throw new Error("INSTALLER_REQUIRED");
    if (file.size < 1 || file.size > MAX) throw new Error("INVALID_FILE_SIZE");
    const extension = extname(file.name).toLowerCase();
    if (!allowed.has(extension)) throw new Error("INVALID_FILE_TYPE");
    const input = fields.parse(Object.fromEntries([...form.entries()].filter(([key]) => key !== "installer")));
    const product = await db.product.findUnique({ where: { id } });
    if (!product) throw new Error("NOT_FOUND");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const objectKey = `products/${id}/${input.version}/${randomUUID()}${extension}`;
    await uploadObject(objectKey, bytes, file.type || "application/octet-stream");
    uploaded = { objectKey, productId: id, actorId: admin.id };
    const version = await db.$transaction(async (tx) => {
      if (input.latest === "true" && input.publish === "true") await tx.productVersion.updateMany({ where: { productId: id, active: true, publishedAt: { not: null }, lifecycle: { in: ["STABLE", "LTS"] } }, data: { isLatest: false } });
      return tx.productVersion.create({ data: { productId: id, version: input.version, releaseNotes: input.releaseNotes, operatingSystem: input.operatingSystem, architecture: input.architecture, active: input.publish === "true", publishedAt: input.publish === "true" ? new Date() : null, isLatest: input.latest === "true", artifacts: { create: { productId: id, name: file.name, objectKey, sha256, sizeBytes: file.size, contentType: file.type || "application/octet-stream", active: input.publish === "true" } } } });
    });
    uploaded = null;
    await db.supplyChainEvidence.create({ data: { versionId: version.id, releaseIdentifier: `${product.slug}@${version.version}`, commitHash: process.env.GIT_COMMIT ?? "unknown", branch: process.env.GIT_BRANCH ?? "unknown", buildEnvironment: process.env.BUILD_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown", builderIdentity: process.env.BUILDER_IDENTITY ?? "unidentified", builtAt: new Date(), manifestJson: { artifacts: [{ name: file.name, sha256, sizeBytes: file.size }] }, dependencyVerified: Boolean(process.env.LOCKFILE_VERIFIED === "true") } });
    await audit({ actorId: admin.id, action: "PRODUCT_VERSION_UPLOADED", targetType: "ProductVersion", targetId: version.id, metadata: { productId: id, version: input.version, sha256, sizeBytes: file.size, operatingSystem: input.operatingSystem, architecture: input.architecture } });
    return NextResponse.json({ id: version.id, version: version.version, sha256, sizeBytes: file.size }, { status: 201 });
  } catch (error) {
    if (uploaded) await deleteObject(uploaded.objectKey).catch(() => queueStorageCleanup({ type: "ABANDONED_UPLOAD", targetType: "ProductVersionUpload", targetId: randomUUID(), objectKey: uploaded!.objectKey, productId: uploaded!.productId, actorId: uploaded!.actorId }));
    return apiError(error);
  }
}
