import { describe, expect, it } from "vitest";
import { readNamedTestCredentials, runProtectedTestProbe } from "../scripts/probe-paymongo-infisical.mjs";

const env = Object.freeze({
  GITHUB_REPOSITORY: "jan2xo/bke-digital-solutions",
  GITHUB_REF: "refs/heads/main",
  INFISICAL_PRODUCTION_IDENTITY_ID: "existing-protected-identity-id",
  INFISICAL_PRODUCTION_PROJECT_ID: "existing-infisical-project-id",
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://pipelines.actions.githubusercontent.com/oidc?job=protected",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "github-protected-request-token",
});
const credentials = Object.freeze({
  PAYMONGO_TEST_MODE_SECRET_KEY: "sk_test_" + "t".repeat(32),
  PAYMONGO_TEST_MODE_WEBHOOK_SECRET: "whsec_" + "w".repeat(32),
});

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

function stubProvider(overrides: Partial<typeof credentials> = {}) {
  const names: string[] = [];
  const fetchImpl = async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const parsed = new URL(url);
    if (parsed.hostname === "pipelines.actions.githubusercontent.com") {
      expect(init.headers?.authorization).toBe("Bearer " + env.ACTIONS_ID_TOKEN_REQUEST_TOKEN);
      return json({ value: "jwt-" + "x".repeat(160) });
    }
    if (parsed.pathname === "/api/v1/auth/oidc-auth/login") {
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body ?? "{}")).toEqual({
        identityId: env.INFISICAL_PRODUCTION_IDENTITY_ID,
        jwt: "jwt-" + "x".repeat(160),
      });
      return json({ accessToken: "token-" + "z".repeat(70) });
    }
    if (parsed.pathname.startsWith("/api/v4/secrets/")) {
      expect(parsed.searchParams.get("environment")).toBe("prod");
      expect(parsed.searchParams.get("secretPath")).toBe("/");
      expect(parsed.searchParams.get("projectId")).toBe(env.INFISICAL_PRODUCTION_PROJECT_ID);
      expect(init.headers?.authorization).toBe("Bearer " + "token-" + "z".repeat(70));
      const name = decodeURIComponent(parsed.pathname.slice("/api/v4/secrets/".length));
      names.push(name);
      const value = { ...credentials, ...overrides }[name as keyof typeof credentials];
      return json({ secret: { secretValue: value } }, value ? 200 : 404);
    }
    if (parsed.pathname === "/v1/payment_methods") {
      expect(init.method).toBe("GET");
      expect(init.headers?.authorization).toBe(
        "Basic " + Buffer.from(credentials.PAYMONGO_TEST_MODE_SECRET_KEY + ":").toString("base64"),
      );
      return json({ data: [] });
    }
    throw new Error("unexpected network destination");
  };
  return { fetchImpl, names };
}

describe("existing protected Infisical OIDC connection with named TEST secrets", () => {
  it("only requests the two TEST secrets, never a production secret, and creates isolated TEST env", async () => {
    const stub = stubProvider();
    const result = await readNamedTestCredentials({ environment: env, fetchImpl: stub.fetchImpl });
    expect(stub.names).toEqual([
      "PAYMONGO_TEST_MODE_SECRET_KEY",
      "PAYMONGO_TEST_MODE_WEBHOOK_SECRET",
    ]);
    expect(result).toEqual({
      DEPLOYMENT_ENV: "test", PAYMENT_PROVIDER: "paymongo", PAYMONGO_LIVEMODE: "false",
      ...credentials,
    });
    expect(Object.keys(result)).toHaveLength(5);
  });

  it("can authenticate a TEST-only key without creating a checkout", async () => {
    const stub = stubProvider();
    const result = await runProtectedTestProbe({ environment: env, fetchImpl: stub.fetchImpl });
    expect(result).toMatchObject({ status: "PASS", checkout: "NOT_REQUESTED" });
    expect(stub.names).toHaveLength(2);
  });

  it.each([
    ["wrong repository", { GITHUB_REPOSITORY: "other-org/other-repo" }],
    ["non-main reference", { GITHUB_REF: "refs/heads/feature" }],
    ["missing identity", { INFISICAL_PRODUCTION_IDENTITY_ID: "" }],
    ["missing project", { INFISICAL_PRODUCTION_PROJECT_ID: "" }],
    ["untrusted OIDC host", { ACTIONS_ID_TOKEN_REQUEST_URL: "https://example.com/request" }],
    ["missing OIDC request token", { ACTIONS_ID_TOKEN_REQUEST_TOKEN: "" }],
  ])("fails closed before network: %s", async (_label, change) => {
    let requests = 0;
    await expect(readNamedTestCredentials({
      environment: { ...env, ...change },
      fetchImpl: async () => { requests++; throw new Error("unexpected network"); },
    })).rejects.toThrow(/^PAYMONGO_TEST_/);
    expect(requests).toBe(0);
  });

  it("rejects missing named webhook secret and never falls back to production webhook key", async () => {
    const stub = stubProvider({ PAYMONGO_TEST_MODE_WEBHOOK_SECRET: "" });
    await expect(readNamedTestCredentials({ environment: env, fetchImpl: stub.fetchImpl }))
      .rejects.toThrow(/^PAYMONGO_TEST_INFISICAL_NAMED_SECRET_/);
    expect(stub.names).toEqual(["PAYMONGO_TEST_MODE_SECRET_KEY", "PAYMONGO_TEST_MODE_WEBHOOK_SECRET"]);
  });

  it("rejects a mislabeled LIVE secret key before contacting PayMongo", async () => {
    const stub = stubProvider({ PAYMONGO_TEST_MODE_SECRET_KEY: "sk_live_" + "x".repeat(32) });
    await expect(runProtectedTestProbe({ environment: env, fetchImpl: stub.fetchImpl }))
      .rejects.toThrow("PAYMONGO_TEST_KEY_MISSING_OR_NOT_TEST");
  });
});
