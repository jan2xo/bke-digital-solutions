import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ACCOUNTS_PURCHASE_ACCESS_CAPABILITY_ID,
  type AccountsPurchaseAccessCapability,
} from "@bke/accounts/contracts/purchase-access.contract";
import { requireUser } from "@/v2/apps/web/auth/session";
import { getV2WebApplication } from "@/v2/apps/web/runtime";
import { assertSameOrigin, clientIp } from "@/v2/apps/web/http/request";
import { rateLimit } from "@/v2/apps/web/http/rate-limit";
import { grantProductTrial } from "@/v2/apps/web/trials/service";
import { apiError } from "@/v2/apps/web/http/api-error";
import { assertLegalAcceptanceCurrent } from "@/v2/apps/web/legal/service";

const schema = z.object({ editionId: z.string().cuid(), accountId: z.string().cuid() }).strict();
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await assertLegalAcceptanceCurrent(user.id);
    if (!user.emailVerified) throw new Error("EMAIL_NOT_VERIFIED");
    if (!(await rateLimit(`trial:${user.id}:${clientIp(request)}`, 5, 3600)).allowed) throw new Error("RATE_LIMITED");
    const input = schema.parse(await request.json());
    const application = await getV2WebApplication();
    const purchaseAccess = application.get<AccountsPurchaseAccessCapability>(
      ACCOUNTS_PURCHASE_ACCESS_CAPABILITY_ID,
    );
    const access = await purchaseAccess.authorize({ principalId: user.id, accountId: input.accountId });
    if (access.status !== "AUTHORIZED") throw new Error(access.code);
    const trial = await grantProductTrial({ accountId: access.account.id, editionId: input.editionId, source: "SELF_SERVICE", actorId: user.id });
    return NextResponse.json({ trialId: trial.id, expiresAt: trial.graceEndsAt }, { status: 201 });
  } catch (error) { return apiError(error); }
}
