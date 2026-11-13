import { readFileSync } from "node:fs";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  environment: vi.fn(),
  rate: vi.fn(),
  parse: vi.fn(),
  ip: vi.fn(() => "127.0.0.1"),
  issuer: vi.fn(),
}));
vi.mock("@/platform/host/env", () => ({
  getRuntimeEnvironment: mocks.environment,
}));
vi.mock("@/apps/web/http/rate-limit", () => ({
  rateLimit: mocks.rate,
}));
vi.mock("@/apps/web/http/request", () => ({
  clientIp: mocks.ip,
}));
vi.mock("@/apps/web/agent-sessions/agent-key-http", () => ({
  smallJson: mocks.parse,
}));
vi.mock("@/apps/web/agent-sessions/standalone-startup-policy-issuance", () => ({
  issueStandaloneStartupPolicyPreproduction: mocks.issuer,
}));

import {
  standaloneStartupPolicyHttp, STARTUP_POLICY_HTTP_PROTOCOL,
} from "@/apps/web/agent-sessions/standalone-startup-policy-http";

const attestation = JSON.stringify({
  schema: "bke.agent-startup-install-attestation-envelope.v1",
  kid: "mock-installed-agent-attestation",
  payload: "signed-installed-agent-json-proven-by-DS-not-the-HTTP-adapter",
  signature: "test-proof-bounded-by-existing-issuer",
});
const staging = Object.freeze({
  DEPLOYMENT_ENV: "staging",
  STANDALONE_STARTUP_POLICY_HTTP_ENABLED: true,
  STANDALONE_STARTUP_POLICY_ISSUANCE_ENABLED: true,
  ACCOUNT_PRODUCT_LEASE_SIGNING_KEYS_JSON: "DUMMY_TEST_ONLY",
});
const signedPolicy = "bke.signed-staging-envelope.test-only";
const issued = Object.freeze({
  status: "issued",
  envelope: signedPolicy,
  kid: "test-preproduction-ds-signer",
  mode: "LICENSE_KEY",
  expiresAt: "2026-11-13T13:00:00.0000000+00:00",
});

function request(headers: Record<string, string> = {}) {
  return new Request("https://preproduction.example.test/api/agent-sessions/startup-policy", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-bke-startup-policy-protocol": STARTUP_POLICY_HTTP_PROTOCOL,
      ...headers,
    },
    body: JSON.stringify({ signed_install_attestation: attestation }),
  });
}

describe("preproduction installed Agent → signed DS startup policy HTTP", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("DEPLOYMENT_ENV", "staging");
    mocks.environment.mockReturnValue({ ...staging });
    mocks.rate.mockResolvedValue({ allowed: true });
    mocks.parse.mockResolvedValue({ signed_install_attestation: attestation });
    mocks.issuer.mockResolvedValue(issued);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("hard-denies production before reading runtime config, limiter, body or signer", async () => {
    vi.stubEnv("DEPLOYMENT_ENV", "production");
    expect((await standaloneStartupPolicyHttp(request())).status).toBe(404);
    expect(mocks.environment).not.toHaveBeenCalled();
    expect(mocks.rate).not.toHaveBeenCalled();
    expect(mocks.parse).not.toHaveBeenCalled();
    expect(mocks.issuer).not.toHaveBeenCalled();
    vi.stubEnv("DEPLOYMENT_ENV", "staging");
    mocks.environment.mockReturnValueOnce({ ...staging, DEPLOYMENT_ENV: "production" });
    expect((await standaloneStartupPolicyHttp(request())).status).toBe(404);
    expect(mocks.issuer).not.toHaveBeenCalled();
  });

  it("requires actual staging plus both independent default-OFF switches and signer custody", async () => {
    for (const runtime of [
      { ...staging, DEPLOYMENT_ENV: "development" },
      { ...staging, DEPLOYMENT_ENV: "test" },
      { ...staging, STANDALONE_STARTUP_POLICY_HTTP_ENABLED: false },
      { ...staging, STANDALONE_STARTUP_POLICY_ISSUANCE_ENABLED: false },
      { ...staging, ACCOUNT_PRODUCT_LEASE_SIGNING_KEYS_JSON: undefined },
    ]) {
      mocks.environment.mockReturnValueOnce(runtime);
      expect((await standaloneStartupPolicyHttp(request())).status).toBe(404);
    }
    expect(mocks.rate).not.toHaveBeenCalled();
    expect(mocks.issuer).not.toHaveBeenCalled();
  });

  it("forbids browser origin, browser cookies and unrelated customer bearer", async () => {
    expect((await standaloneStartupPolicyHttp(request({
      origin: "https://customer.example.test",
    }))).status).toBe(403);
    expect((await standaloneStartupPolicyHttp(request({
      cookie: "session=cannot-be-issuer-authority",
    }))).status).toBe(403);
    expect((await standaloneStartupPolicyHttp(request({
      authorization: "Bearer account-session-is-not-installed-attestation",
    }))).status).toBe(403);
    expect(mocks.parse).not.toHaveBeenCalled();
    expect(mocks.issuer).not.toHaveBeenCalled();
  });

  it("requires a separate explicit installed-machine protocol version", async () => {
    const result = await standaloneStartupPolicyHttp(request({
      "x-bke-startup-policy-protocol": "bke.account-session.v1",
    }));
    expect(result.status).toBe(400);
    expect(await result.json()).toEqual({ error: "PROTOCOL_MISMATCH" });
    expect(mocks.rate).not.toHaveBeenCalled();
  });

  it("throttles by IP first, then by hashed machine KID, never raw private data", async () => {
    mocks.rate.mockResolvedValueOnce({ allowed: false });
    expect((await standaloneStartupPolicyHttp(request())).status).toBe(429);
    expect(mocks.parse).not.toHaveBeenCalled();
    expect(mocks.issuer).not.toHaveBeenCalled();

    mocks.rate.mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({ allowed: false });
    expect((await standaloneStartupPolicyHttp(request())).status).toBe(429);
    expect(mocks.issuer).not.toHaveBeenCalled();
    const labels = mocks.rate.mock.calls.map(call => String(call[0]));
    expect(labels.some(label => label.includes("startup-policy:http:ip:127.0.0.1"))).toBe(true);
    expect(labels.some(label => label.includes("startup-policy:http:machine:"))).toBe(true);
    expect(labels.join(" ")).not.toContain("mock-installed-agent-attestation");
  });

  it("rejects unrecognized object fields and unbounded/untrusted attestation", async () => {
    for (const body of [
      { signed_install_attestation: attestation, account_id: "untrusted-login" },
      { signed_install_attestation: "" },
      { signed_install_attestation: "a".repeat(7001) },
      { signed_install_attestation: "not-json" },
      { signed_install_attestation: JSON.stringify({ kid: 12345 }) },
      { signed_install_attestation: JSON.stringify({ kid: "bad kid with spaces" }) },
    ]) {
      mocks.parse.mockResolvedValueOnce(body);
      expect((await standaloneStartupPolicyHttp(request())).status).toBe(400);
    }
    expect(mocks.issuer).not.toHaveBeenCalled();
  });

  it("bounds raw request parser error without echoing input", async () => {
    mocks.parse.mockRejectedValueOnce(new Error("PAYLOAD_TOO_LARGE"));
    const result = await standaloneStartupPolicyHttp(request());
    expect(result.status).toBe(413);
    expect(await result.json()).toEqual({ error: "PAYLOAD_TOO_LARGE" });
    expect(mocks.issuer).not.toHaveBeenCalled();
  });

  it("fails closed when rate-limiter is unavailable", async () => {
    mocks.rate.mockRejectedValueOnce(new Error(
      "Distributed rate limiter is not configured",
    ));
    const result = await standaloneStartupPolicyHttp(request());
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ error: "ISSUER_UNAVAILABLE" });
    expect(mocks.issuer).not.toHaveBeenCalled();
  });

  it("returns only the signed policy after the existing transaction issuer succeeds", async () => {
    const result = await standaloneStartupPolicyHttp(request());
    expect(result.status).toBe(201);
    expect(await result.json()).toEqual({
      status: "issued", signed_policy_envelope: signedPolicy,
      kid: issued.kid, activation_mode: "LICENSE_KEY",
      expires_at: issued.expiresAt,
    });
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(result.headers.get("x-bke-startup-policy-protocol"))
      .toBe(STARTUP_POLICY_HTTP_PROTOCOL);
    expect(mocks.issuer).toHaveBeenCalledTimes(1);
    expect(mocks.issuer).toHaveBeenCalledWith(attestation);
    expect(mocks.rate).toHaveBeenCalledTimes(2);
  });

  it("never returns a policy before the existing issuer resolves its commit", async () => {
    let complete!: (value: typeof issued) => void;
    mocks.issuer.mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
    let returned = false;
    const pending = standaloneStartupPolicyHttp(request()).then(() => { returned = true; });
    // Let parser, rate limits and issuer call execute.
    await vi.waitFor(() => expect(mocks.issuer).toHaveBeenCalledTimes(1));
    expect(returned).toBe(false);
    complete(issued);
    await pending;
    expect(returned).toBe(true);
  });

  it("rejects replay, untrusted attestation or missing release without exposing keys", async () => {
    for (const [message, status] of [
      ["STARTUP_POLICY_ATTESTATION_REPLAY", 409],
      ["STARTUP_ATTESTATION_UNTRUSTED_AGENT", 403],
      ["STARTUP_ES256_UNTRUSTED_AGENT", 403],
      ["STARTUP_POLICY_SQL_MODE_OR_RELEASE_UNAVAILABLE", 403],
      ["ACCOUNT_PRODUCT_SIGNER_KEY_MISMATCH", 403],
      ["SECRET_PRIVATE_SIGNING_KEY_DUMP", 503],
    ] as const) {
      mocks.issuer.mockRejectedValueOnce(new Error(message));
      const result = await standaloneStartupPolicyHttp(request());
      expect(result.status).toBe(status);
      const exposed = JSON.stringify(await result.json());
      expect(exposed).not.toContain(message);
      expect(exposed).not.toContain("PRIVATE");
      expect(exposed).not.toContain(signedPolicy);
    }
  });

  it("has one POST-only route and default-off staging preproduction flags", () => {
    const route = readFileSync("app/api/agent-sessions/startup-policy/route.ts", "utf8");
    const config = readFileSync("platform/host/config/environment.ts", "utf8");
    const adapter = readFileSync(
      "apps/web/agent-sessions/standalone-startup-policy-http.ts", "utf8");
    expect(route).toContain("export async function POST");
    expect(route).not.toContain("export async function GET");
    expect(route).not.toContain("export async function PUT");
    expect(config).toContain("STANDALONE_STARTUP_POLICY_HTTP_ENABLED: bool.default(false)");
    expect(config).toContain('value.STANDALONE_STARTUP_POLICY_HTTP_ENABLED &&');
    expect(config).toContain('value.DEPLOYMENT_ENV !== "staging"');
    expect(config).toContain("STANDALONE_STARTUP_POLICY_ISSUANCE_ENABLED: bool.default(false)");
    expect(adapter).toContain('config.DEPLOYMENT_ENV !== "staging"');
    expect(adapter).toContain('process.env.DEPLOYMENT_ENV === "production"');
    expect(adapter).not.toContain("requireRecentIdentitySession");
    expect(adapter).not.toContain("nativeAgentBearerToken");
    expect(adapter).not.toContain("createPrivateKey");
  });
});
