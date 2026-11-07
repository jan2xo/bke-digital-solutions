import { describe, expect, it } from "vitest";
import { assertMockPaymentsAllowed, assertPayMongoModeAllowed } from "@/apps/web/payments/runtime-policy";

describe("mock payment runtime policy", () => {
  it("allows mock payments for disposable test deployments even in a production Next runtime", () => {
    expect(() => assertMockPaymentsAllowed({
      NODE_ENV: "production",
      DEPLOYMENT_ENV: "test",
    })).not.toThrow();
  });

  it("forbids mock payments for the production deployment", () => {
    expect(() => assertMockPaymentsAllowed({
      NODE_ENV: "production",
      DEPLOYMENT_ENV: "production",
    })).toThrow("V2_MOCK_PAYMENTS_FORBIDDEN_IN_PRODUCTION");
  });
});

describe("real PayMongo runtime isolation", () => {
  const live = {
    DEPLOYMENT_ENV: "production",
    PAYMENT_PROVIDER: "paymongo",
    PAYMONGO_LIVEMODE: "true",
    PAYMONGO_SECRET_KEY: "sk_live_" + "x".repeat(24),
    PAYMONGO_WEBHOOK_SECRET: "whsec_" + "y".repeat(40),
    PROVIDER_CONFIG_SOURCE: "environment",
  };
  it("permits an explicitly configured live-only checkout adapter without contacting PayMongo", () => {
    expect(() => assertPayMongoModeAllowed(live)).not.toThrow();
  });
  it.each([
    { DEPLOYMENT_ENV: "staging" },
    { DEPLOYMENT_ENV: "test" },
    { PAYMENT_PROVIDER: "mock" },
    { PAYMONGO_LIVEMODE: "false" },
    { PROVIDER_CONFIG_SOURCE: "database" },
    { PAYMONGO_SECRET_KEY: "sk_test_" + "x".repeat(24) },
    { PAYMONGO_SECRET_KEY: "" },
    { PAYMONGO_WEBHOOK_SECRET: "" },
    { PAYMONGO_WEBHOOK_SECRET: live.PAYMONGO_SECRET_KEY },
  ])("fails closed when live configuration is unsafe: %o", (change) => {
    expect(() => assertPayMongoModeAllowed({ ...live, ...change })).toThrow();
  });
  it("forbids a live key in a non-live adapter", () => {
    expect(() => assertPayMongoModeAllowed({
      ...live, DEPLOYMENT_ENV: "staging", PAYMONGO_LIVEMODE: "false",
    })).toThrow("PAYMONGO_LIVE_KEY_FORBIDDEN_OUTSIDE_LIVEMODE");
  });
});
