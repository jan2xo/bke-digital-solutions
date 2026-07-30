import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/security/crypto";
import { downloadObject } from "@/lib/storage";

export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const tokenHash = hashToken(token);
  const grant = await db.$transaction(async (tx) => {
    const claimed = await tx.downloadGrant.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) return null;
    return tx.downloadGrant.findUnique({ where: { tokenHash }, include: { artifact: true } });
  });
  if (!grant) return NextResponse.json({ error: "INVALID_OR_USED_GRANT" }, { status: 404 });
  const bytes = await downloadObject(grant.artifact.objectKey);
  const safe = grant.artifact.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  return new NextResponse(Buffer.from(bytes), { headers: {
    "content-type": grant.artifact.contentType,
    "content-disposition": `attachment; filename="${safe}"`,
    "cache-control": "no-store",
  } });
}
