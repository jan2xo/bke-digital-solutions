import { NextResponse } from "next/server";
import { z } from "zod";
import {
  IDENTITY_PASSWORD_RESET_COMPLETION_CAPABILITY_ID,
  type IdentityPasswordResetCompletionCapability,
} from "@bke/identity/contracts/password-reset-completion.contract";
import { securityEvent } from "@/lib/security/events";
import { getV2WebApplication } from "@/v2/apps/web/runtime";
import { assertSameOrigin } from "@/v2/apps/web/http/request";
import { passwordSchema } from "@/v2/apps/web/http/validation";

const schema = z.object({ token: z.string().min(20), password: passwordSchema });

export async function POST(request: Request) {
  assertSameOrigin(request);
  const input = schema.parse(await request.json());
  if (input.token !== input.token.trim()) {
    return NextResponse.json({ error: "INVALID_TOKEN" }, { status: 400 });
  }

  const application = await getV2WebApplication();
  const passwordReset = application.get<IdentityPasswordResetCompletionCapability>(
    IDENTITY_PASSWORD_RESET_COMPLETION_CAPABILITY_ID,
  );
  const result = await passwordReset.complete(input);
  if (result.status === "INVALID") {
    return NextResponse.json({ error: result.code }, { status: 400 });
  }
  if (result.status === "FAILED") throw new Error(result.code);

  if (result.role === "ADMIN") {
    await securityEvent("PASSWORD_RESET_COMPLETED", request, result.userId);
  }
  return NextResponse.json({ ok: true });
}
