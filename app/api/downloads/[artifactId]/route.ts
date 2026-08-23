import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/security/rate-limit";
import { apiError } from "@/lib/http";
import { assertLegalAcceptanceCurrent } from "@/lib/legal/service";
import { CUSTOMER_RELEASE_LIFECYCLES } from "@/lib/releases/eligibility";

export async function GET(_: Request, { params }: { params: Promise<{ artifactId: string }> }) {
  try {
    const user = await requireUser();
    await assertLegalAcceptanceCurrent(user.id);
    if (!user.emailVerified) throw new Error("FORBIDDEN");
    if (!(await rateLimit(`download:${user.id}`, 30, 3600)).allowed) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    const { artifactId: versionId } = await params;
    const access = {
      OR: [
        { account: { ownerId: user.id } },
        { account: { memberships: { some: { userId: user.id, role: { in: ["OWNER" as const, "LICENSE_MANAGER" as const] } } } } },
        { assignments: { some: { userId: user.id } } },
      ],
    };
    const version = await db.productVersion.findFirst({ where: { id: versionId, active: true, publishedAt: { not: null }, lifecycle: { in: [...CUSTOMER_RELEASE_LIFECYCLES] }, product: { active: true, archivedAt: null } }, select: { id: true, productId: true, externalUrl: true } });
    if (!version?.externalUrl) throw new Error("NOT_FOUND");
    const license = await db.license.findFirst({ where: { productId: version.productId, status: "ACTIVE", account: { lifecycleState: "ACTIVE" }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }], AND: access } });
    if (!license) throw new Error("NOT_FOUND");
    await db.licenseEvent.create({ data: { licenseId: license.id, type: "DOWNLOAD_REDIRECTED", metadata: { versionId: version.id } } });
    return NextResponse.redirect(version.externalUrl, { status: 303 });
  } catch (error) { return apiError(error); }
}
