import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/security/crypto";
import { downloadObject } from "@/v2/apps/web/storage/object-storage";
import { rateLimit } from "@/v2/apps/web/http/rate-limit";
import { clientIp } from "@/v2/apps/web/http/request";
import { audit } from "@/lib/audit";
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!(await rateLimit(`download-grant:${clientIp(request)}`, 30, 3600)).allowed) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  const { token } = await params; const tokenHash = hashToken(token); const now = new Date();
  const grant = await db.$transaction(async (tx) => { const claimed = await tx.downloadGrant.updateMany({ where: { tokenHash, usedAt: null, OR: [{ processingAt: null }, { processingAt: { lt: new Date(now.getTime() - 10 * 60 * 1000) } }], expiresAt: { gt: now }, license: { status: "ACTIVE", account: { lifecycleState: "ACTIVE" }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }, data: { processingAt: now } }); if (claimed.count !== 1) return null; return tx.downloadGrant.findUnique({ where: { tokenHash }, include: { artifact: true, license: true } }); });
  if (!grant) return NextResponse.json({ error: "INVALID_OR_USED_GRANT" }, { status: 404 });
  let bytes: Uint8Array; try { bytes = await downloadObject(grant.artifact.objectKey); } catch { await db.downloadGrant.updateMany({ where: { id: grant.id, usedAt: null }, data: { processingAt: null } }); return NextResponse.json({ error: "DOWNLOAD_UNAVAILABLE" }, { status: 503 }); }
  await db.$transaction([db.downloadGrant.update({ where: { id: grant.id }, data: { usedAt: new Date(), processingAt: null } }), db.productArtifact.update({ where: { id: grant.artifactId }, data: { downloadCount: { increment: 1 } } }), db.licenseEvent.create({ data: { licenseId: grant.licenseId, type: "DOWNLOAD_REDEEMED", metadata: { grantId: grant.id, artifactId: grant.artifactId } } })]);
  await audit({ accountId: grant.license.accountId, action: "DOWNLOAD_GRANT_REDEEMED", targetType: "DownloadGrant", targetId: grant.id });
  const safe = grant.artifact.name.replace(/[^a-zA-Z0-9._-]/g, "_"); return new NextResponse(Buffer.from(bytes), { headers: { "content-type": grant.artifact.contentType, "content-disposition": `attachment; filename="${safe}"`, "cache-control": "no-store" } });
}
