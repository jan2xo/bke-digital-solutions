import { NextResponse } from "next/server";
import { terminateCurrentIdentitySession } from "@/v2/apps/web/auth/session";
import { apiError } from "@/v2/apps/web/http/api-error";
import { assertSameOrigin } from "@/v2/apps/web/http/request";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await terminateCurrentIdentitySession();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
