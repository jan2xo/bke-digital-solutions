import https from "node:https";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = join(ROOT_DIR, ".env.certification");
const CA_FILE = join(ROOT_DIR, ".bke-disposable", "tls", "bke-v3-disposable-ca.crt.pem");
const PROTOCOL = "bke.account-session.v1";

function pass(label, detail = "") {
  console.info(`[PASS] ${label}${detail ? ` — ${detail}` : ""}`);
}

function fail(label, detail = "") {
  console.error(`[FAIL] ${label}${detail ? ` — ${detail}` : ""}`);
  process.exitCode = 1;
}

function runCheck(label, command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT_DIR,
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0) {
    fail(label, (result.stderr || result.stdout || "command failed").trim().slice(0, 500));
    return false;
  }
  pass(label);
  return true;
}

function request(path, { method = "GET", body, headers = {} } = {}) {
  const ca = readFileSync(CA_FILE);
  const payload = body === undefined ? undefined : JSON.stringify(body);

  return new Promise((resolveRequest, rejectRequest) => {
    const req = https.request({
      hostname: "127.0.0.1",
      port: 8443,
      path,
      method,
      servername: "bke-v3.test",
      ca,
      rejectUnauthorized: true,
      headers: {
        Host: "bke-v3.test:8443",
        Accept: "application/json",
        ...headers,
        ...(payload
          ? {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(payload),
            }
          : {}),
      },
      timeout: 5_000,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null;
        }
        resolveRequest({
          status: response.statusCode ?? 0,
          headers: response.headers,
          text,
          json,
        });
      });
    });

    req.on("timeout", () => req.destroy(new Error("request timeout")));
    req.on("error", rejectRequest);
    if (payload) req.write(payload);
    req.end();
  });
}

async function retryRequest(path, options, {
  attempts = 30,
  accept = (response) => response.status > 0,
} = {}) {
  let lastError;
  let lastResponse;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await request(path, options);
      lastResponse = response;
      if (accept(response)) return response;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
  }
  if (lastResponse) return lastResponse;
  throw lastError ?? new Error("request did not become available");
}

async function main() {
  console.info("BKE V3 disposable doctor");
  console.info("Authority: https://bke-v3.test:8443");

  if (!existsSync(ENV_FILE)) {
    fail("environment", ".env.certification is missing");
    return;
  }
  const envText = readFileSync(ENV_FILE, "utf8");
  if (!envText.includes("BKE_DISPOSABLE_CERTIFICATION=true")) {
    fail("environment", "refusing non-disposable .env.certification");
    return;
  }
  pass("environment", "disposable marker present");

  if (!existsSync(CA_FILE)) {
    fail("TLS trust", "disposable CA certificate is missing");
    return;
  }
  pass("TLS trust", "disposable CA available");

  if (!runCheck("environment schema", "npm", ["run", "certification:check"])) return;
  if (!runCheck("Compose configuration", "docker", [
    "compose",
    "-p",
    "bke-v3-disposable",
    "--env-file",
    ".env.certification",
    "-f",
    "docker-compose.production.yml",
    "-f",
    "docker-compose.disposable.yml",
    "config",
    "--quiet",
  ])) return;

  let health;
  try {
    health = await retryRequest("/api/health/ready", undefined, {
      accept: (response) => response.status === 200 && response.json?.status === "ready",
    });
  } catch (error) {
    fail("HTTPS readiness", error instanceof Error ? error.message : String(error));
    return;
  }

  if (health.status !== 200 || health.json?.status !== "ready") {
    fail("HTTPS readiness", `HTTP ${health.status}: ${health.text.slice(0, 500)}`);
    return;
  }
  pass("HTTPS readiness", "HTTP 200");

  const dependencies = health.json?.dependencies ?? {};
  for (const [name, state] of Object.entries(dependencies)) {
    if (state === "up") pass(`dependency:${name}`);
    else fail(`dependency:${name}`, String(state));
  }
  if (process.exitCode) return;

  let started;
  try {
    started = await request("/api/agent-sessions/device/start", {
      method: "POST",
      headers: { "x-bke-account-session-version": PROTOCOL },
      body: {
        device_id: `bke-v3-doctor-${randomUUID()}`,
        device_name: "BKE V3 Disposable Doctor",
        platform: "windows",
        architecture: "arm64",
      },
    });
  } catch (error) {
    fail("Agent account-session start", error instanceof Error ? error.message : String(error));
    return;
  }

  if (started.status !== 201) {
    fail("Agent account-session start", `HTTP ${started.status}: ${started.text.slice(0, 500)}`);
    return;
  }
  if (started.headers["x-bke-account-session-version"] !== PROTOCOL) {
    fail("Agent account-session protocol", "response version header mismatch");
    return;
  }
  if (
    typeof started.json?.verification_uri !== "string" ||
    !started.json.verification_uri.startsWith("https://bke-v3.test:8443/")
  ) {
    fail("Agent verification URI", "unexpected authority");
    return;
  }

  pass("Agent account-session start", "HTTP 201");
  pass("Agent account-session protocol", PROTOCOL);
  pass("Agent verification authority", "bke-v3.test:8443");
  console.info("DISPOSABLE CERTIFICATION GATE: PASS");
}

main().catch((error) => {
  fail("doctor", error instanceof Error ? error.stack ?? error.message : String(error));
});
