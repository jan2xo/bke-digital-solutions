import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { hashToken, randomToken } from "@/lib/security/crypto";
import { rateLimit } from "@/v2/apps/web/http/rate-limit";
import { apiError } from "@/v2/apps/web/http/api-error";
import { assertLegalAcceptanceCurrent } from "@/lib/legal/service";
import { resolveEligibleReleaseForArtifact } from "@/lib/releases/resolution";

export async function GET(_: Request, { params }: { params: Promise<{ artifactId: string }> }) {
  try {
    const user = await requireUser();
    await assertLegalAcceptanceCurrent(user.id);
    if (!user.emailVerified) throw new Error("FORBIDDEN");
    if (!(await rateLimit(`download:${user.id}`, 30, 3600)).allowed) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    const { artifactId } = await params;
    const access = {
      OR: [
        { account: { ownerId: user.id } },
        { account: { memberships: { some: { userId: user.id, role: { in: ["OWNER" as const, "LICENSE_MANAGER" as const] } } } } },
        { assignments: { some: { userId: user.id } } },
      ],
    };
    const artifact = await resolveEligibleReleaseForArtifact(artifactId);
    if (!artifact) throw new Error("NOT_FOUND");
    const license = await db.license.findFirst({ where: { productId: artifact.productId, status: "ACTIVE", account: { lifecycleState: "ACTIVE" }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }], AND: access } });
    if (!license) throw new Error("NOT_FOUND");
    const token = randomToken();
    await db.downloadGrant.create({ data: { licenseId: license.id, artifactId: artifact.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60_000) } });
    return NextResponse.redirect(new URL(`/api/downloads/grants/${token}`, process.env.APP_URL), { status: 303 });
  } catch (error) { return apiError(error); }
}
