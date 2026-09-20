import { NextRequest, NextResponse } from "next/server";
import { randomBytes, randomUUID } from "node:crypto";

export function proxy(request: NextRequest) {
  if (request.method === "DELETE" && request.nextUrl.pathname.startsWith("/api/admin/") && process.env.DEPLOYMENT_ENV === "production" && process.env.ALLOW_DESTRUCTIVE_ADMIN !== "true") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  const nonce = randomBytes(16).toString("base64");
  const requestHeaders = new Headers(request.headers);
  const correlationId = request.headers.get("x-correlation-id")?.match(/^[A-Za-z0-9._:-]{1,128}$/) ? request.headers.get("x-correlation-id")! : randomUUID();
  requestHeaders.set("x-correlation-id", correlationId);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("x-request-id", request.headers.get("x-request-id")?.slice(0, 128) || randomUUID());
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-correlation-id", correlationId);
  const devEval = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
  response.headers.set("Content-Security-Policy", `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${devEval}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`);
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  if (process.env.DEPLOYMENT_ENV === "production") response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
