import {
  ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID,
  type AccountsAccountAccessCapability,
} from "@bke/accounts/contracts/account-access.contract";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/v2/apps/web/http/api-error";
import { createPrivacyRequest, normalizePrivacyRequestType, PRIVACY_REQUEST_TYPES } from "@/lib/privacy/requests";
import { assertSameOrigin } from "@/v2/apps/web/http/request";
import { getV2WebApplication } from "@/v2/apps/web/runtime";

const schema = z.object({ requestType: z.enum(PRIVACY_REQUEST_TYPES), summary: z.string().trim().min(10).max(2_000), accountId: z.string().cuid().optional() }).strict();

export async function GET() {
  try {
    const user = await requireUser();
    const requests = await db.privacyRequest.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, select: { id: true, requestType: true, status: true, summary: true, responseSummary: true, reviewedAt: true, closedAt: true, createdAt: true } });
    return NextResponse.json(requests);
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const input = schema.parse(await request.json());
    if (input.accountId) {
      const application = await getV2WebApplication();
      const accountAccess = application.get<AccountsAccountAccessCapability>(
        ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID,
      );
      const access = await accountAccess.authorize({ principalId: user.id, accountId: input.accountId });
      if (access.status === "REJECTED" || access.status === "FAILED") throw new Error(access.code);
    }
    const created = await createPrivacyRequest({ userId: user.id, accountId: input.accountId, requestType: normalizePrivacyRequestType(input.requestType), summary: input.summary, request });
    return NextResponse.json({ id: created.id, status: created.status }, { status: 201 });
  } catch (error) { return apiError(error); }
}
