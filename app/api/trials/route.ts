import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertSameOrigin, clientIp } from "@/lib/security/request";
import { rateLimit } from "@/lib/security/rate-limit";
import { grantProductTrial } from "@/lib/trials";
import { apiError } from "@/lib/http";

const schema = z.object({ editionId: z.string().cuid(), accountId: z.string().cuid() }).strict();
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    if (!user.emailVerified) throw new Error("EMAIL_NOT_VERIFIED");
    if (!(await rateLimit(`trial:${user.id}:${clientIp(request)}`, 5, 3600)).allowed) throw new Error("RATE_LIMITED");
    const input = schema.parse(await request.json());
    const account = await db.customerAccount.findFirst({ where: { id: input.accountId, OR: [{ ownerId: user.id }, { memberships: { some: { userId: user.id, role: { in: ["OWNER", "BILLING"] } } } }] } });
    if (!account) throw new Error("NOT_FOUND");
    const trial = await grantProductTrial({ accountId: account.id, editionId: input.editionId, source: "SELF_SERVICE", actorId: user.id });
    return NextResponse.json({ trialId: trial.id, expiresAt: trial.graceEndsAt }, { status: 201 });
  } catch (error) { return apiError(error); }
}
