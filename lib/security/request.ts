import "server-only";
import { env } from "@/lib/env";

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || new URL(origin).origin !== new URL(env.APP_URL).origin) throw new Error("INVALID_ORIGIN");
}

export async function readLimitedBody(request: Request, maxBytes = 256_000) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > maxBytes) throw new Error("PAYLOAD_TOO_LARGE");
  const body = Buffer.from(await request.arrayBuffer());
  if (body.length > maxBytes) throw new Error("PAYLOAD_TOO_LARGE");
  return body;
}

export function clientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
