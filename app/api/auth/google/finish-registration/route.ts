import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  GOOGLE_ENROLLMENT_COOKIE, readPendingGoogleEnrollment, consumePendingGoogleEnrollment,
} from "@/apps/web/auth/google-enrollment";
import { registrationLegalDocuments, pendingReacceptance } from "@/apps/web/legal/service";
import { registerGoogleCustomer } from "@/apps/web/auth/google-registration";
import {
  IDENTITY_GOOGLE_AUTHENTICATION_CAPABILITY_ID,
  type IdentityGoogleAuthenticationCapability,
} from "@bke/identity/contracts/google-authentication.contract";
import { getIdentityWebApplication } from "@/apps/web/auth/runtime";
import { issueGoogleIdentitySession } from "@/apps/web/auth/session";
import { assertSameOrigin, clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { apiError } from "@/apps/web/http/api-error";
import { safeLocalRedirect } from "@/apps/web/security/redirect";

const consentSchema = z.object({
  legalVersionIds: z.array(z.string().cuid()).length(2),
}).strict();

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (!(await rateLimit(`google-enrollment:${clientIp(request)}`, 10, 900)).allowed) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }
    const token = (await cookies()).get(GOOGLE_ENROLLMENT_COOKIE)?.value;
    if (!token) throw new Error("UNAUTHENTICATED");
    const pending = await readPendingGoogleEnrollment(token);
    const input = consentSchema.parse(await request.json());

    // Validate current published versions before consuming a one-time enrollment.
    const documents = await registrationLegalDocuments();
    const required = documents.map((document) => (
      document.currentPublishedVersion?.status === "PUBLISHED"
        ? document.currentPublishedVersionId : null
    ));
    if (required.length !== 2 || required.some((id) => !id) ||
        required.some((id) => !input.legalVersionIds.includes(id!)) ||
        new Set(input.legalVersionIds).size !== 2) {
      return NextResponse.json({ error: "LEGAL_ACCEPTANCE_REQUIRED" }, { status: 409 });
    }
    if (!(await consumePendingGoogleEnrollment(pending.jti))) {
      throw new Error("UNAUTHENTICATED");
    }

    await registerGoogleCustomer({
      subject: pending.subject, email: pending.email,
      emailVerified: pending.emailVerified, hostedDomain: pending.hostedDomain,
      name: pending.name, legalVersionIds: input.legalVersionIds, request,
    });
    const application = await getIdentityWebApplication();
    const authentication = application.get<IdentityGoogleAuthenticationCapability>(
      IDENTITY_GOOGLE_AUTHENTICATION_CAPABILITY_ID,
    );
    const result = await authentication.authenticate({ subject: pending.subject });
    if (result.status !== "PRIMARY_AUTHENTICATED" || result.principal.role !== "CUSTOMER") {
      throw new Error("UNAUTHENTICATED");
    }
    await issueGoogleIdentitySession({
      userId: result.principal.id, subject: pending.subject,
      authenticatedAt: pending.authenticatedAt, request,
    });
    const returnTo = safeLocalRedirect(pending.returnTo);
    const destination = (await pendingReacceptance(result.principal.id)).length > 0
      ? `/legal/accept?returnTo=${encodeURIComponent(returnTo)}`
      : returnTo;
    const response = NextResponse.json({ redirectTo: destination });
    response.cookies.delete(GOOGLE_ENROLLMENT_COOKIE);
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    // Identity conflicts are deliberately not disclosed through the public API.
    if (error instanceof Error && error.message === "LEGAL_ACCEPTANCE_REQUIRED") {
      return apiError(error);
    }
    return NextResponse.json({ error: "GOOGLE_ENROLLMENT_FAILED" }, { status: 403 });
  }
}
