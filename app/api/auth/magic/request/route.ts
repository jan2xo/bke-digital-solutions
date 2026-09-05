import { NextResponse } from "next/server";
import {
  IDENTITY_MAGIC_LOGIN_REQUEST_CAPABILITY_ID,
  type IdentityMagicLoginRequestCapability,
} from "@bke/identity/contracts/magic-login-request.contract";
import { sendMagicLink } from "@/lib/email";
import { getV2WebApplication } from "@/v2/apps/web/runtime";
import { emailSchema } from "@/v2/apps/web/http/validation";
import { assertSameOrigin, clientIp } from "@/v2/apps/web/http/request";
import { rateLimit } from "@/v2/apps/web/http/rate-limit";

export async function POST(request: Request) {
  assertSameOrigin(request);
  const email = emailSchema.parse((await request.json()).email);
  if (!(await rateLimit(`magic:${clientIp(request)}:${email}`, 5, 3600)).allowed) {
    return NextResponse.json({ ok: true });
  }

  const application = await getV2WebApplication();
  const magicLogin = application.get<IdentityMagicLoginRequestCapability>(
    IDENTITY_MAGIC_LOGIN_REQUEST_CAPABILITY_ID,
  );
  const result = await magicLogin.request({ email });
  if (result.status === "FAILED") throw new Error(result.code);
  if (result.delivery) {
    await sendMagicLink(result.delivery.recipientEmail, result.delivery.token);
  }
  return NextResponse.json({ ok: true });
}
