import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { requireAccountAccess } from "@/lib/authorization";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";
import { createPrivacyRequest, normalizePrivacyRequestType, PRIVACY_REQUEST_TYPES } from "@/lib/privacy/requests";
import { assertSameOrigin } from "@/lib/security/request";

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
      await requireAccountAccess(user.id, input.accountId);
    }
    const created = await createPrivacyRequest({ userId: user.id, accountId: input.accountId, requestType: normalizePrivacyRequestType(input.requestType), summary: input.summary, request });
    return NextResponse.json({ id: created.id, status: created.status }, { status: 201 });
  } catch (error) { return apiError(error); }
}
