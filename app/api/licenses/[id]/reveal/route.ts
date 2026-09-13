import { NextResponse } from "next/server";
import { requireRecentUser } from "@/v2/apps/web/auth/session";
import { db } from "@/v2/platform/host/db";
import { decryptLicenseKey } from "@/v2/platform/host/security/crypto";
import { assertSameOrigin } from "@/v2/apps/web/http/request";
import { apiError } from "@/v2/apps/web/http/api-error";
import { assertLegalAcceptanceCurrent } from "@/v2/apps/web/legal/service";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireRecentUser();
    await assertLegalAcceptanceCurrent(user.id);
    const { id } = await params;
    const license = await db.license.findFirst({
      where: {
        id,
        account: {
          lifecycleState: "ACTIVE",
          OR: [
            { ownerId: user.id },
            { memberships: { some: { userId: user.id, role: { in: ["OWNER", "LICENSE_MANAGER"] } } } },
          ],
        },
      },
    });
    if (!license) throw new Error("NOT_FOUND");
    if (!license.keyCiphertext) return NextResponse.json({ error: "LICENSE_KEY_UNAVAILABLE" }, { status: 409 });

    const key = decryptLicenseKey(license.keyCiphertext);
    await db.license.update({
      where: { id },
      data: {
        keyRevealedAt: license.keyRevealedAt ?? new Date(),
        events: { create: { type: "CUSTOMER_REVEALED", metadata: { actorId: user.id } } },
      },
      select: { id: true },
    });
    return NextResponse.json({ licenseKey: key });
  } catch (error) {
    return apiError(error);
  }
}
