import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";

const correlationIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;

function correlationId(request: NextRequest) {
  const supplied = request.headers.get("x-correlation-id");
  return supplied && correlationIdPattern.test(supplied) ? supplied : randomUUID();
}

export function middleware(request: NextRequest) {
  const id = correlationId(request);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-correlation-id", id);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-correlation-id", id);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
