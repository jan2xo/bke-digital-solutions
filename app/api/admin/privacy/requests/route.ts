import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRecentAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/v2/apps/web/http/api-error";
import { transitionPrivacyRequest } from "@/lib/privacy/requests";
import { assertSameOrigin } from "@/v2/apps/web/http/request";

const schema = z.object({ status: z.enum(["IN_REVIEW", "FULFILLED", "REJECTED", "CANCELLED"]), responseSummary: z.string().trim().min(2).max(2_000) }).strict();

export async function GET() {
  try {
    await requireRecentAdmin();
    const requests = await db.privacyRequest.findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 200, include: { user: { select: { email: true, name: true } }, customerAccount: { select: { displayName: true } }, reviewedBy: { select: { email: true, name: true } } } });
    return NextResponse.json(requests);
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireRecentAdmin();
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new Error("NOT_FOUND");
    const input = schema.parse(await request.json());
    const updated = await transitionPrivacyRequest({ actorId: admin.id, requestId: id, status: input.status, responseSummary: input.responseSummary });
    return NextResponse.json(updated);
  } catch (error) { return apiError(error); }
}
