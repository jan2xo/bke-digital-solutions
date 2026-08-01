import { NextResponse } from "next/server";

export function apiError(error: unknown) {
  const code = error instanceof Error ? error.message : "INTERNAL_ERROR";
  const status = ({ UNAUTHENTICATED: 401, EMAIL_NOT_VERIFIED: 403, FORBIDDEN: 403, RECENT_AUTH_REQUIRED: 403, MFA_REQUIRED: 403, MFA_ENROLLMENT_REQUIRED: 403, INVALID_MFA_CODE: 401, INVALID_MFA_CHALLENGE: 401, NOT_FOUND: 404, CHECKOUT_CREATION_IN_PROGRESS: 409, TRIAL_REVOKED: 409, INVALID_ORIGIN: 403, RATE_LIMITED: 429, PAYLOAD_TOO_LARGE: 413 } as Record<string, number>)[code] ?? 400;
  const publicCode = status >= 500 ? "INTERNAL_ERROR" : code;
  return NextResponse.json({ error: publicCode }, { status });
}
