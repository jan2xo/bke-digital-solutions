import { NextResponse } from "next/server";
import { requireUser } from "@/v2/apps/web/auth/session";
import { db } from "@/v2/platform/host/db";
import { rateLimit } from "@/v2/apps/web/http/rate-limit";
import { apiError } from "@/v2/apps/web/http/api-error";
import { assertLegalAcceptanceCurrent } from "@/v2/apps/web/legal/service";
import { githubLatestReleaseUrl } from "@/v2/platform/distribution/github-releases";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    await assertLegalAcceptanceCurrent(user.id);
    if (!user.emailVerified) throw new Error("FORBIDDEN");
    if (!(await rateLimit(`download:${user.id}`, 30, 3600)).allowed) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }

    const { id } = await params;
    const access = {
      OR: [
        { account: { ownerId: user.id } },
        { account: { memberships: { some: { userId: user.id, role: { in: ["OWNER" as const, "LICENSE_MANAGER" as const] } } } } },
        { assignments: { some: { userId: user.id } } },
      ],
    };
    const license = await db.license.findFirst({
      where: {
        id,
        status: "ACTIVE",
        account: { lifecycleState: "ACTIVE" },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        AND: access,
      },
      include: { product: { select: { productId: true } } },
    });
    if (!license) throw new Error("NOT_FOUND");

    const releaseUrl = githubLatestReleaseUrl(license.product.productId);
    if (!releaseUrl) throw new Error("NOT_FOUND");
    return NextResponse.redirect(new URL(releaseUrl), { status: 303 });
  } catch (error) {
    return apiError(error);
  }
}
