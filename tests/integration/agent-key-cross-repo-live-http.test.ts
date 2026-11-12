import "dotenv/config";
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { X509Certificate, randomUUID, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../platform/host/generated/prisma/client";
import { hashAgentAccessToken, hashAgentDeviceCode } from "@/apps/web/agent-sessions/material";

const AGENT_EXACT_SHA = "8135b6673bd6800bd0d30e29b623439a43bac6d3";
const AGENT_PUBLIC_REPO = "https://github.com/jan2xo/bke-licensing-agent.git";
const pepper = "ci-bke-crossrepo-session-pepper-615f94d88362bc9da0e2e1c43c1e4297";
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});
const execAsync = promisify(execFile);

describe("LIVE disposable DS HTTP routes ↔ separate exact-SHA Agent .NET process", {
  concurrent: false,
}, () => {
  const temp = mkdtempSync(join(tmpdir(), "bke-ds-agent-live-"));
  const certPath = join(temp, "loopback.cert.pem");
  const keyPath = join(temp, "loopback.private.pem");
  const agentRoot = join(temp, "licensing-agent-source");
  let server: Server | null = null;
  let userId = "", accountId = "", sessionId = "", deviceId = "", accessToken = "";
  let baseUrl = "", certHash = "";
  let handlerCount = 0;
  let deviceCode = "";

  beforeAll(async () => {
    // Strictly disposable test-only environment, never a production toggle.
    process.env.AGENT_ACCOUNT_SESSION_ENABLED = "true";
    process.env.AGENT_KEY_HTTP_ENABLED = "true";
    process.env.DEPLOYMENT_ENV = "test";
    process.env.AGENT_ACCOUNT_SESSION_PEPPER = pepper;
    process.env.AGENT_ACCOUNT_SESSION_ENCRYPTION_KEY = "ci-bke-crossrepo-envelope-0b1a72428a1e4462b816d805a4f63e4e";

    const { POST: enroll } = await import("@/app/api/agent-sessions/keys/enroll/route");
    const { POST: verify } = await import("@/app/api/agent-sessions/keys/verify/route");
    const { POST: status } = await import("@/app/api/agent-sessions/keys/status/route");
    const { POST: revoke } = await import("@/app/api/agent-sessions/keys/revoke/route");
    const routes: Record<string, (request: Request) => Promise<Response>> = {
      "/api/agent-sessions/keys/enroll": enroll,
      "/api/agent-sessions/keys/verify": verify,
      "/api/agent-sessions/keys/status": status,
      "/api/agent-sessions/keys/revoke": revoke,
    };

    execFileSync("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes",
      "-keyout", keyPath, "-out", certPath,
      "-days", "1", "-subj", "/CN=127.0.0.1",
      "-addext", "subjectAltName=IP:127.0.0.1",
    ], { stdio: "ignore", timeout: 15_000 });
    certHash = new X509Certificate(readFileSync(certPath))
      .fingerprint256.replaceAll(":", "").toUpperCase();

    server = createServer({
      key: readFileSync(keyPath), cert: readFileSync(certPath),
    }, async (req, res) => {
      try {
        // This is ACTUAL DS route code on HTTPS and the same disposable
        // PostgreSQL used by core CI. It is not a simulated response handler.
        if (req.method !== "POST" || !req.url || !routes[req.url]) {
          res.writeHead(404); res.end(); return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const value of req) {
          const part = Buffer.from(value);
          size += part.length;
          if (size > 16_384) {
            res.writeHead(413); res.end(); return;
          }
          chunks.push(part);
        }
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
          if (value === undefined) continue;
          headers.set(key, Array.isArray(value) ? value.join(",") : value);
        }
        const body = Buffer.concat(chunks);
        const native = new Request("https://127.0.0.1" + req.url, {
          method: "POST", headers, body,
        });
        handlerCount++;
        const result = await routes[req.url]!(native);
        const responseBody = Buffer.from(await result.arrayBuffer());
        const outgoing: Record<string, string> = {};
        for (const [key, value] of result.headers.entries()) outgoing[key] = value;
        res.writeHead(result.status, outgoing);
        res.end(responseBody);
      } catch (error) {
        // Do not emit bearer, key material, or JSON request bytes to CI logs.
        res.writeHead(500, { "cache-control": "no-store" });
        res.end('{"error":"DISPOSABLE_HANDLER_FAILURE"}');
        console.error("Disposable DS route failed", error instanceof Error ? error.name : "error");
      }
    });
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address() as AddressInfo;
    baseUrl = "https://127.0.0.1:" + address.port + "/";

    const suffix = randomUUID().slice(0, 8);
    const user = await db.user.create({ data: {
      email: "bke-http-" + suffix + "@bke.test",
      emailVerified: new Date(),
      ownedAccounts: { create: {
        type: "INDIVIDUAL", displayName: "Disposable Cross-Repo",
        billingEmail: "bke-http-" + suffix + "@bke.test",
      } },
    }, include: { ownedAccounts: true } });
    userId = user.id;
    accountId = user.ownedAccounts[0]!.id;
    sessionId = randomUUID();
    deviceId = "bke-device-http-" + randomUUID();
    accessToken = "bke-test-live-agent-access-" + randomUUID();
    deviceCode = randomBytes(32).toString("base64url");
    const authorizationId = randomUUID();
    const now = new Date(), accessExpiry = new Date(now.getTime() + 15 * 60_000);
    await db.$executeRaw`
      INSERT INTO "AgentDeviceAuthorization" (
        "id","deviceCodeHash","userCodeHash","deviceId","platform",
        "architecture","status","expiresAt","pollIntervalSeconds",
        "approvedByUserId","approvedAccountId","approvedAt","consumedAt",
        "handoffExpiresAt","sessionId","authorizationKind"
      ) VALUES (
        ${authorizationId}, ${hashAgentDeviceCode(deviceCode, pepper)}, ${randomUUID()}, ${deviceId},
        'windows','x64','CONSUMED', ${accessExpiry}, 5,
        ${userId},${accountId},${now},${now},${accessExpiry},${sessionId},'DEVICE_CODE'
      )
    `;
    await db.$executeRaw`
      INSERT INTO "AgentAccountSession" (
        "id","deviceAuthorizationId","userId","accountId","deviceId",
        "accessTokenHash","accessExpiresAt","refreshExpiresAt"
      ) VALUES (
        ${sessionId},${authorizationId},${userId},${accountId},${deviceId},
        ${hashAgentAccessToken(accessToken, pepper)},${accessExpiry},
        ${new Date(now.getTime() + 86_400_000)}
      )
    `;
  }, 120_000);

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await db.$disconnect();
    rmSync(temp, { recursive: true, force: true });
    delete process.env.AGENT_KEY_HTTP_ENABLED;
    delete process.env.AGENT_ACCOUNT_SESSION_ENABLED;
    delete process.env.AGENT_ACCOUNT_SESSION_PEPPER;
    delete process.env.AGENT_ACCOUNT_SESSION_ENCRYPTION_KEY;
  });

  it("checks out exact Agent SHA and runs real signed enrollment/status/revoke over HTTPS", async () => {
    const git = (args: string[]) => execFileSync("git", args, {
      timeout: 90_000, encoding: "utf8",
    }).trim();
    git(["init", "--quiet", agentRoot]);
    git(["-C", agentRoot, "remote", "add", "origin", AGENT_PUBLIC_REPO]);
    git(["-C", agentRoot, "fetch", "--depth=1", "origin", AGENT_EXACT_SHA]);
    git(["-C", agentRoot, "checkout", "--detach", "FETCH_HEAD"]);
    const fetched = git(["-C", agentRoot, "rev-parse", "HEAD"]);
    expect(fetched).toBe(AGENT_EXACT_SHA);

    // Same immutable Agent binary is exercised with TWO distinct approved
    // disposable machine sessions, avoiding revoked-key silent rotation.
    for (const algorithm of ["EdDSA", "ES256"] as const) {
      if (algorithm === "ES256") {
        sessionId = randomUUID();
        deviceId = "bke-device-http-" + randomUUID();
        accessToken = "bke-test-live-agent-access-" + randomUUID();
        deviceCode = randomBytes(32).toString("base64url");
        const authorizationId = randomUUID();
        const now = new Date();
        const accessExpiry = new Date(now.getTime() + 15 * 60_000);
        await db.$executeRaw`
          INSERT INTO "AgentDeviceAuthorization" (
            "id","deviceCodeHash","userCodeHash","deviceId","platform",
            "architecture","status","expiresAt","pollIntervalSeconds",
            "approvedByUserId","approvedAccountId","approvedAt","consumedAt",
            "handoffExpiresAt","sessionId","authorizationKind"
          ) VALUES (
            ${authorizationId},${hashAgentDeviceCode(deviceCode, pepper)},${randomUUID()},${deviceId},
            'windows','x64','CONSUMED',${accessExpiry},5,
            ${userId},${accountId},${now},${now},${accessExpiry},${sessionId},'NATIVE_HANDOFF'
          )
        `;
        await db.$executeRaw`
          INSERT INTO "AgentAccountSession" (
            "id","deviceAuthorizationId","userId","accountId","deviceId",
            "accessTokenHash","accessExpiresAt","refreshExpiresAt"
          ) VALUES (
            ${sessionId},${authorizationId},${userId},${accountId},${deviceId},
            ${hashAgentAccessToken(accessToken, pepper)},${accessExpiry},
            ${new Date(now.getTime() + 86_400_000)}
          )
        `;
      }
      // SDK must be available; no silent skip or mocked client transport.
      const result = await execAsync("dotnet", [
        "run", "--project", join(agentRoot, "dotnet/certification/BKE.LicensingAgent.DsHttpCertification/BKE.LicensingAgent.DsHttpCertification.csproj"),
        "--configuration", "Release", "--", "--live-disposable-ds",
      ], {
        timeout: 180_000, maxBuffer: 1_000_000,
        env: {
          ...process.env,
          DOTNET_CLI_TELEMETRY_OPTOUT: "1",
          BKE_CROSS_REPO_SIGNER_ALGORITHM: algorithm,
          BKE_CROSS_REPO_URL: baseUrl,
          BKE_CROSS_REPO_CERT_SHA256: certHash,
          BKE_CROSS_REPO_BEARER: accessToken,
          BKE_CROSS_REPO_SESSION_ID: sessionId,
          BKE_CROSS_REPO_ACCOUNT_ID: accountId,
          BKE_CROSS_REPO_USER_ID: userId,
          BKE_CROSS_REPO_DEVICE_ID: deviceId,
          BKE_CROSS_REPO_DEVICE_CODE: deviceCode,
        },
      });
      expect(result.stdout).toContain("BKE LIVE CROSS-REPO HTTPS + POSTGRESQL PASS");
      expect(result.stdout).toContain("8 assertions; algorithm=" + algorithm);
    }
    // Each of the two real .NET processes makes authenticated route requests.
    expect(handlerCount).toBeGreaterThanOrEqual(12);
  }, 240_000);
});
