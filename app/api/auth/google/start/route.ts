import { NextResponse } from "next/server";
import { z } from "zod";
import { registrationLegalDocuments } from "@/apps/web/legal/service";
import { assertSameOrigin, clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { createGoogleAuthorizationRequest, GOOGLE_LOGIN_CONTEXT_COOKIE } from "@/apps/web/auth/google-oidc";
import { apiError } from "@/apps/web/http/api-error";

const loginSchema = z.object({
  flow: z.literal("login"),
  returnTo: z.string().max(2048).optional(),
}).strict();
const registerSchema = z.object({
  flow: z.literal("register"),
  legalVersionIds: z.array(z.string().cuid()).length(2),
}).strict();

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (!(await rateLimit(`google-login:${clientIp(request)}`, 10, 900)).allowed) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }

    const body: unknown = await request.json();
    let input:
      | { flow: "login"; returnTo?: string }
      | { flow: "register"; legalVersionIds: string[] };
    if (typeof body === "object" && body !== null && "flow" in body && body.flow === "register") {
      input = registerSchema.parse(body);
      const docs = await registrationLegalDocuments();
      const required = docs.map((document) => document.currentPublishedVersionId);
      if (required.length !== 2 || !input.legalVersionIds.every((id) => required.includes(id))) {
        return NextResponse.json({ error: "LEGAL_ACCEPTANCE_REQUIRED" }, { status: 409 });
      }
    } else {
      input = loginSchema.parse(body);
    }

    const result = await createGoogleAuthorizationRequest(input);
    const response = NextResponse.json({ authorizationUrl: result.authorizationUrl });
    response.cookies.set(GOOGLE_LOGIN_CONTEXT_COOKIE, result.encryptedContext, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
    return response;
  } catch (error) {
    return apiError(error);
  }
}
