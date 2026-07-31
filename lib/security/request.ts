import "server-only";
import { env } from "@/lib/env";

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const trusted = new Set([new URL(env.APP_URL).origin, ...(env.TRUSTED_ORIGINS?.split(",").map((value) => new URL(value.trim()).origin) ?? [])]);
  if (!origin || !trusted.has(new URL(origin).origin)) throw new Error("INVALID_ORIGIN");
}

export async function readLimitedBody(request: Request, maxBytes = 256_000) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > maxBytes) throw new Error("PAYLOAD_TOO_LARGE");
  const body = Buffer.from(await request.arrayBuffer());
  if (body.length > maxBytes) throw new Error("PAYLOAD_TOO_LARGE");
  return body;
}

export function clientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  return forwarded.at(-Math.max(1, env.TRUST_PROXY_HOPS)) || "unknown";
}
