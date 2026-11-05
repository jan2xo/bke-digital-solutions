import { pathToFileURL } from "node:url";

// Standalone trusted-main Staging credential check. It intentionally does not
// import or execute code from the PR being certified.
const BODY_LIMIT = 4096;
const CODES = new Set([
  "PONG", "CONFIG_MISSING", "INVALID_URL", "AUTH_UNAUTHORIZED",
  "AUTH_FORBIDDEN", "REDIRECT_BLOCKED", "HTTP_ERROR", "TIMEOUT",
  "NETWORK_ERROR", "BODY_TOO_LARGE", "BODY_READ_ERROR",
  "INVALID_RESPONSE", "PONG_MISMATCH",
]);

export function upstashPingEndpoint(raw) {
  if (typeof raw !== "string" || !raw.trim()) throw new Error("INVALID_URL");
  let url;
  try { url = new URL(raw); } catch { throw new Error("INVALID_URL"); }
  const authority = /^https:\/\/([^/?#]*)/i.exec(raw)?.[1] ?? "";
  const explicitPath = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*(\/[^?#]*)?/i.exec(raw)?.[1];
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" || url.username || url.password ||
    authority.includes("@") || /[?#]/.test(raw) || url.search || url.hash ||
    (url.port && url.port !== "443") || url.pathname !== "/" ||
    (explicitPath && explicitPath !== "/") ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+upstash\.io$/.test(host)
  ) throw new Error("INVALID_URL");
  return new URL("/ping", url.origin);
}

export async function verifyStagingRedis(env = process.env, fetchImpl = globalThis.fetch) {
  const result = (code, httpStatus = null, pong = false) =>
    ({ code, httpStatus, pong });
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  const rawUrl = env.UPSTASH_REDIS_REST_URL;
  if (typeof token !== "string" || !token.trim() ||
      typeof rawUrl !== "string" || !rawUrl.trim()) {
    return result("CONFIG_MISSING");
  }
  let endpoint;
  try { endpoint = upstashPingEndpoint(rawUrl); }
  catch { return result("INVALID_URL"); }
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "GET",
      headers: { authorization: "Bearer " + token, accept: "application/json" },
      credentials: "omit",
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    const name = error?.name;
    return result(name === "TimeoutError" || name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR");
  }
  if (response.status !== 200) {
    try { await response.body?.cancel(); } catch {}
    if (response.status === 401) return result("AUTH_UNAUTHORIZED", 401);
    if (response.status === 403) return result("AUTH_FORBIDDEN", 403);
    if (response.status >= 300 && response.status < 400)
      return result("REDIRECT_BLOCKED", response.status);
    return result("HTTP_ERROR", response.status);
  }
  const sizeHeader = response.headers.get("content-length");
  if (sizeHeader !== null && Number.isFinite(Number(sizeHeader)) &&
      Number(sizeHeader) > BODY_LIMIT) {
    try { await response.body?.cancel(); } catch {}
    return result("BODY_TOO_LARGE", 200);
  }
  const reader = response.body?.getReader();
  if (!reader) return result("INVALID_RESPONSE", 200);
  const chunks = [];
  let total = 0;
  try {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > BODY_LIMIT) {
          await reader.cancel();
          return result("BODY_TOO_LARGE", 200);
        }
        chunks.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
  } catch { return result("BODY_READ_ERROR", 200); }
  let payload;
  try { payload = JSON.parse(Buffer.concat(chunks, total).toString("utf8")); }
  catch { return result("INVALID_RESPONSE", 200); }
  return payload?.result === "PONG" ? result("PONG", 200, true) : result("PONG_MISMATCH", 200);
}

export async function main() {
  const output = await verifyStagingRedis();
  // Only fixed diagnostic enums, numeric HTTP status and a boolean are printed.
  // Never emit URL, token, response body, request headers or raw exceptions.
  const safe = CODES.has(output.code) ? output : { code: "NETWORK_ERROR", httpStatus: null, pong: false };
  process.stdout.write(JSON.stringify(safe) + "\n");
  if (!safe.pong) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stdout.write('{"code":"NETWORK_ERROR","httpStatus":null,"pong":false}\n');
    process.exitCode = 1;
  });
}
