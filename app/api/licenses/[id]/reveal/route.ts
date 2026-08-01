import { NextResponse } from "next/server";
import { requireRecentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptLicenseKey } from "@/lib/security/crypto";
import { assertSameOrigin } from "@/lib/security/request";
import { apiError } from "@/lib/http";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireRecentUser();
    const { id } = await params;
    const license = await db.license.findFirst({
      where: {
        id,
        account: {
          OR: [
            { ownerId: user.id },
            { memberships: { some: { userId: user.id, role: { in: ["OWNER", "LICENSE_MANAGER", "BILLING"] } } } },
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
