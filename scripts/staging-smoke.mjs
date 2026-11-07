import { pathToFileURL } from "node:url";

export const STAGING_ORIGIN = "https://bkedigitalsolutions.com";
const REQUEST_TIMEOUT_MS = 10_000;
const HTML_LIMIT_BYTES = 1_048_576;
const JSON_LIMIT_BYTES = 65_536;
const REQUIRED_DEPENDENCIES = ["postgresql", "valkey", "providers"];

function networkCode(error) {
  if (error && typeof error === "object") {
    const name = "name" in error && typeof error.name === "string" ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") return "TIMEOUT";
    const cause = "cause" in error ? error.cause : undefined;
    if (cause && typeof cause === "object" && "code" in cause &&
        typeof cause.code === "string" && /^[A-Z0-9_]+$/.test(cause.code)) {
      return cause.code;
    }
  }
  return "NETWORK_ERROR";
}

async function boundedText(response, path, limitBytes) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limitBytes) {
        await reader.cancel();
        throw new Error("STAGING_SMOKE_RESPONSE_TOO_LARGE");
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof Error && error.message === "STAGING_SMOKE_RESPONSE_TOO_LARGE") {
      throw new Error(`Public Staging smoke GET ${path} response exceeded its size limit`);
    }
    throw new Error(`Public Staging smoke GET ${path} response read failed (${networkCode(error)})`);
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, bytes).toString("utf8");
}

async function get(path, accept, fetchImpl, allowedStatuses = [200]) {
  let response;
  try {
    response = await fetchImpl(new URL(path, STAGING_ORIGIN), {
      method: "GET",
      headers: { accept },
      credentials: "omit",
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`Public Staging smoke GET ${path} failed (${networkCode(error)})`);
  }
  if (!allowedStatuses.includes(response.status)) {
    throw new Error(`Public Staging smoke GET ${path} expected HTTP 200, received ${response.status}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (accept === "text/html" && !contentType.toLowerCase().includes("text/html")) {
    throw new Error(`Public Staging smoke GET ${path} did not return HTML`);
  }
  if (accept === "application/json" && !contentType.toLowerCase().includes("application/json")) {
    throw new Error(`Public Staging smoke GET ${path} did not return JSON`);
  }
  return { status: response.status, text: await boundedText(response, path, accept === "text/html" ? HTML_LIMIT_BYTES : JSON_LIMIT_BYTES) };
}

export async function verifyPublicStaging(fetchImpl = globalThis.fetch) {
  const home = await get("/", "text/html", fetchImpl);
  if (!home.text.toLowerCase().includes("<html")) {
    throw new Error("Public Staging smoke GET / returned no HTML document");
  }

  const login = await get("/login", "text/html", fetchImpl);
  if (!login.text.includes("Sign in with Google")) {
    throw new Error("Public Staging smoke GET /login lacks the Google sign-in affordance");
  }

  const { status: readinessStatus, text: rawReadiness } = await get("/api/health/ready", "application/json", fetchImpl, [200, 503]);
  let health;
  try {
    health = JSON.parse(rawReadiness);
  } catch {
    throw new Error("Public Staging readiness returned invalid JSON");
  }
  const dependencySummary = health?.dependencies && typeof health.dependencies === "object"
    ? [...REQUIRED_DEPENDENCIES.map((name) => `${name} ${health.dependencies[name] === "up" ? "up" : health.dependencies[name] === "down" ? "down" : "missing"}`), `objectStorage ${Object.hasOwn(health.dependencies, "objectStorage") ? "present" : "absent"}`].join(", ")
    : "dependency statuses missing";
  if (readinessStatus !== 200 || health?.status !== "ready" || !health.dependencies ||
      REQUIRED_DEPENDENCIES.some((name) => health.dependencies[name] !== "up") ||
      Object.hasOwn(health.dependencies, "objectStorage")) {
    throw new Error(`Public Staging readiness failed (HTTP ${readinessStatus}; ${dependencySummary})`);
  }

  console.log("Public Staging smoke passed: / 200, /login 200 with Google sign-in, readiness 200 (postgresql, valkey, providers up).");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyPublicStaging().catch((error) => {
    console.error(error instanceof Error ? error.message : "Public Staging smoke failed");
    process.exitCode = 1;
  });
}
