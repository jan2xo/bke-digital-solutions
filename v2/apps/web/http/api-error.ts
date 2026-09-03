import { NextResponse } from "next/server";

const statuses: Record<string, number> = {
  UNAUTHENTICATED: 401,
  EMAIL_NOT_VERIFIED: 403,
  FORBIDDEN: 403,
  ACCOUNT_NOT_ACTIVE: 403,
  ACCOUNT_ROLE_FORBIDDEN: 403,
  RECENT_AUTH_REQUIRED: 403,
  MFA_REQUIRED: 403,
  MFA_ENROLLMENT_REQUIRED: 403,
  INVALID_MFA_CODE: 401,
  INVALID_MFA_CHALLENGE: 401,
  SESSION_NOT_FOUND: 404,
  SESSION_NOT_OWNED: 403,
  NOT_FOUND: 404,
  LEGAL_ACCEPTANCE_REQUIRED: 409,
  LEGAL_REACCEPTANCE_REQUIRED: 409,
  LEGAL_DOCUMENTS_UNAVAILABLE: 503,
  INVALID_ORIGIN: 403,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  INVALID_PURCHASE_PLAN: 422,
  INVALID_CATALOG_PRODUCT: 422,
  INVALID_CATALOG_EDITION: 422,
  PAYMENT_PROVIDER_UNAVAILABLE: 503,
  CHECKOUT_CREATION_IN_PROGRESS: 409,
};

function protocolError(error: unknown): { code: string; status: number } | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { code?: unknown; status?: unknown };
  if (
    typeof candidate.code === "string" &&
    typeof candidate.status === "number" &&
    Number.isInteger(candidate.status) &&
    candidate.status >= 400 &&
    candidate.status <= 599
  ) {
    return { code: candidate.code, status: candidate.status };
  }
  return null;
}

export function apiError(error: unknown) {
  const protocol = protocolError(error);
  if (protocol) return NextResponse.json({ error: protocol.code }, { status: protocol.status });
  const code = error instanceof Error ? error.message : "INTERNAL_ERROR";
  const status = statuses[code] ?? 400;
  return NextResponse.json({ error: status >= 500 ? "INTERNAL_ERROR" : code }, { status });
}
