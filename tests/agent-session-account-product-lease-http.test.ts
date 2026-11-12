import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  environment: vi.fn(),
  rate: vi.fn(),
  begin: vi.fn(),
  issue: vi.fn(),
  transaction: vi.fn(),
  json: vi.fn(),
}));
vi.mock("@/platform/host/env", () => ({
  getRuntimeEnvironment: mocks.environment,
}));
vi.mock("@/apps/web/http/rate-limit", () => ({
  rateLimit: mocks.rate,
}));
// HTTP parsing tests own only request IP semantics, not host env secrets.
vi.mock("@/apps/web/http/request", () => ({
  clientIp: () => "127.0.0.1",
}));
vi.mock("@/platform/host/db", () => ({
  db: { $transaction: mocks.transaction },
}));
vi.mock("@/apps/web/agent-sessions/agent-key-proof-authority", () => ({
  beginAgentLeaseKeyChallenge: mocks.begin,
}));
vi.mock("@/apps/web/agent-sessions/account-product-lease-issuance", () => ({
  issueAgentAccountProductLease: mocks.issue,
}));
vi.mock("@/apps/web/agent-sessions/agent-key-http", () => ({
  smallJson: mocks.json,
}));

import { agentAccountProductLeaseHttp } from "@/apps/web/agent-sessions/account-product-lease-http";

const runtime = {
  DEPLOYMENT_ENV: "staging",
  AGENT_ACCOUNT_SESSION_ENABLED: true,
  AGENT_KEY_HTTP_ENABLED: true,
  ACCOUNT_PRODUCT_LEASE_ISSUANCE_ENABLED: true,
  AGENT_ACCOUNT_SESSION_PEPPER: "ci-agent-pepper-not-a-customer-secret",
  ACCOUNT_PRODUCT_LEASE_SIGNING_KEYS_JSON: "DISPOSABLE_PRIVATE_KEYS_ONLY",
};
const bearer = "signed-test-agent-bearer-no-browser-login";
const now = new Date("2026-11-12T18:00:00Z");
function request(overrides: Record<string, string> = {}) {
  return new Request("https://preproduction.example.test/api/agent-sessions/leases/issue", {
    method: "POST",
    headers: {
      "authorization": "Bearer " + bearer,
      "content-type": "application/json",
      "x-bke-account-session-version": "bke.account-session.v1",
      ...overrides,
    },
    body: JSON.stringify({}),
  });
}
const challenge = {
  registration_id: "00000000-0000-4000-8000-000000000001",
  product_id: "render-dock", action: "OPEN",
};
const payload = {
  challenge_id: "00000000-0000-4000-8000-000000000002",
  message_base64url: "YWJj", signature_base64url: "YWJj",
  product_id: "render-dock", action: "OPEN",
  platform: "windows", architecture: "x64",
};

describe("Agent-only JWS HTTP — disabled production, no Google login", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.environment.mockReturnValue({ ...runtime });
    mocks.rate.mockResolvedValue({ allowed: true });
    mocks.json.mockResolvedValue(payload);
    mocks.issue.mockResolvedValue({
      status: "issued", kid: "test-kid",
      jws: "signed.jws.signature",
      expiresAt: now.toISOString(), refreshAfter: now.toISOString(),
    });
    mocks.begin.mockResolvedValue({
      status: "challenge", registrationId: challenge.registration_id,
      challengeId: payload.challenge_id,
      messageBase64url: payload.message_base64url, expiresAt: now,
    });
    mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({}));
  });

  it("unconditionally disables both endpoints in production", async () => {
    mocks.environment.mockReturnValue({ ...runtime, DEPLOYMENT_ENV: "production" });
    for (const operation of ["issue", "challenge"] as const) {
      const result = await agentAccountProductLeaseHttp(request(), operation);
      expect(result.status).toBe(404);
    }
    expect(mocks.rate).not.toHaveBeenCalled();
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it("defaults off even in staging without explicit three-part opt in", async () => {
    for (const missing of [
      "ACCOUNT_PRODUCT_LEASE_ISSUANCE_ENABLED",
      "AGENT_KEY_HTTP_ENABLED",
      "AGENT_ACCOUNT_SESSION_ENABLED",
    ] as const) {
      mocks.environment.mockReturnValue({ ...runtime, [missing]: false });
      expect((await agentAccountProductLeaseHttp(request(), "issue")).status).toBe(404);
    }
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it("requires actual Agent bearer, not a browser Google cookie or origin", async () => {
    expect((await agentAccountProductLeaseHttp(request({ authorization: "" }), "issue"))
      .status).toBe(401);
    expect((await agentAccountProductLeaseHttp(request({ origin: "https://example.test" }), "issue"))
      .status).toBe(403);
    expect((await agentAccountProductLeaseHttp(request({
      "x-bke-account-session-version": "google-session",
    }), "issue")).status).toBe(400);
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it("requires distributed IP and hashed-bearer rate limits before issuing", async () => {
    mocks.rate.mockResolvedValueOnce({ allowed: true }).mockResolvedValueOnce({ allowed: false });
    expect((await agentAccountProductLeaseHttp(request(), "issue")).status).toBe(429);
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it("strictly refuses identity override and out-of-contract request fields", async () => {
    mocks.json.mockResolvedValueOnce({ ...payload, accountId: "attacker" });
    expect((await agentAccountProductLeaseHttp(request(), "issue")).status).toBe(400);
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it("accepts a narrow challenge and delegates to real session-bound key authority", async () => {
    mocks.json.mockResolvedValue(challenge);
    const res = await agentAccountProductLeaseHttp(request(), "challenge");
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ status: "challenge", registration_id: challenge.registration_id });
    expect(mocks.begin).toHaveBeenCalledWith({}, {
      accessToken: bearer, pepper: runtime.AGENT_ACCOUNT_SESSION_PEPPER,
      registrationId: challenge.registration_id, productId: "render-dock", action: "OPEN",
    });
    expect(mocks.transaction.mock.calls[0]?.[1]).toEqual({
      isolationLevel: "Serializable", timeout: 10_000,
    });
  });

  it("returns signed JWS only after issuer resolves successful atomic commit", async () => {
    const res = await agentAccountProductLeaseHttp(request(), "issue");
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ status: "issued", kid: "test-kid",
      lease_jws: "signed.jws.signature" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mocks.issue).toHaveBeenCalledWith({
      accessToken: bearer, pepper: runtime.AGENT_ACCOUNT_SESSION_PEPPER,
      challengeId: payload.challenge_id,
      messageBase64url: payload.message_base64url,
      signatureBase64url: payload.signature_base64url,
      productId: "render-dock", platform: "windows", architecture: "x64",
      action: "OPEN",
    }, runtime.ACCOUNT_PRODUCT_LEASE_SIGNING_KEYS_JSON);
  });

  it("does not leak signing key, JWS or DB error after failure", async () => {
    mocks.issue.mockRejectedValueOnce(new Error("SECRET_PRIVATE_KEY=oops"));
    const res = await agentAccountProductLeaseHttp(request(), "issue");
    expect(res.status).toBe(503);
    const body = JSON.stringify(await res.json());
    expect(body).toContain("LEASE_ISSUANCE_UNAVAILABLE");
    expect(body).not.toContain("SECRET");
    expect(body).not.toContain("signed.jws");
  });

  it("denied product eligibility or unknown key never returns signed claims", async () => {
    mocks.issue.mockResolvedValueOnce({ status: "denied", reason: "NOT_ELIGIBLE" });
    const res = await agentAccountProductLeaseHttp(request(), "issue");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "INVALID_PROOF" });
  });
});
