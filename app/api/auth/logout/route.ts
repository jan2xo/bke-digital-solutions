import { NextResponse } from "next/server";
import { terminateCurrentIdentitySession } from "@/apps/web/auth/session";
import { apiError } from "@/apps/web/http/api-error";
import { assertSameOrigin } from "@/apps/web/http/request";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await terminateCurrentIdentitySession();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
