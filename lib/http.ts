import { NextResponse } from "next/server";

export function apiError(error: unknown) {
  const code = error instanceof Error ? error.message : "INTERNAL_ERROR";
  const status = ({ UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, INVALID_ORIGIN: 403, PAYLOAD_TOO_LARGE: 413 } as Record<string, number>)[code] ?? 400;
  const publicCode = status >= 500 ? "INTERNAL_ERROR" : code;
  return NextResponse.json({ error: publicCode }, { status });
}
