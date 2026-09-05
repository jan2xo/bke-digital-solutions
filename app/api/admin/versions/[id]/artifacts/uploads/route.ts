import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRecentAdmin } from "@/lib/auth";
import { audit } from "@/v2/apps/web/audit";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { apiError } from "@/v2/apps/web/http/api-error";
import { assertSameOrigin } from "@/v2/apps/web/http/request";
import { createArtifactUploadUrl } from "@/v2/apps/web/storage/object-storage";

const allowedExtensions = new Set([".dmg", ".pkg", ".exe", ".msi", ".zip", ".deb", ".rpm", ".appimage", ".js", ".jsx", ".ts", ".tsx", ".py", ".ps1", ".sh", ".bat", ".cmd", ".vbs", ".jsxbin", ".plugin", ".aex"]);
const inputSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive().max(env.MAX_ARTIFACT_BYTES),
  contentType: z.string().trim().min(1).max(128).default("application/octet-stream"),
  expectedSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
});
const SESSION_TTL_MS = 10 * 60 * 1000;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const admin = await requireRecentAdmin();
    const { id: versionId } = await params;
    const input = inputSchema.parse(await request.json());
    const extension = extname(input.filename).toLowerCase();
    if (!allowedExtensions.has(extension)) throw new Error("INVALID_FILE_TYPE");
    if (/[/\\\u0000-\u001f]/.test(input.filename)) throw new Error("INVALID_FILENAME");

    const version = await db.productVersion.findUniqueOrThrow({ where: { id: versionId }, select: { id: true, productId: true, version: true, lifecycle: true } });
    if (version.lifecycle === "ARCHIVED" || version.lifecycle === "DEPRECATED") throw new Error("VERSION_NOT_ELIGIBLE");

    const uploadId = randomUUID();
    const objectKey = `products/${version.productId}/versions/${version.id}/uploads/${uploadId}${extension}`;
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const contentType = input.contentType || "application/octet-stream";
    const uploadUrl = await createArtifactUploadUrl(objectKey, contentType, input.sizeBytes, SESSION_TTL_MS / 1000);
    await db.artifactUploadSession.create({ data: { id: uploadId, productId: version.productId, versionId: version.id, objectKey, originalFilename: input.filename, extension, contentType, expectedSize: BigInt(input.sizeBytes), expectedSha256: input.expectedSha256?.toLowerCase(), expiresAt, createdById: admin.id } });
    await audit({ actorId: admin.id, action: "ARTIFACT_UPLOAD_INITIATED", targetType: "ProductVersion", targetId: versionId, metadata: { uploadId, expectedSize: input.sizeBytes, extension, expiresAt: expiresAt.toISOString() } });
    return NextResponse.json({ uploadId, objectKey, uploadUrl, expiresAt: expiresAt.toISOString(), expectedSize: input.sizeBytes, contentType }, { status: 201 });
  } catch (error) { return apiError(error); }
}
