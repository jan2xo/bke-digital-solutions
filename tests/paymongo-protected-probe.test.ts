import { describe, expect, it } from "vitest";
import { assertTestModeCredentials, probePayMongoTest } from "../scripts/probe-paymongo-test.mjs";

const valid = {
  DEPLOYMENT_ENV: "test",
  PAYMENT_PROVIDER: "paymongo",
  PAYMONGO_LIVEMODE: "false",
  PAYMONGO_TEST_MODE_SECRET_KEY: "sk_test_" + "a".repeat(28),
  PAYMONGO_TEST_MODE_WEBHOOK_KEY: "whsec_" + "b".repeat(32),
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

describe("protected PayMongo TEST-only probe", () => {
  it("accepts separate scoped test credentials", () => {
    expect(assertTestModeCredentials(valid).key).toMatch(/^sk_test_/);
  });
  it.each([
    ["production environment", { DEPLOYMENT_ENV: "production" }],
    ["live mode", { PAYMONGO_LIVEMODE: "true" }],
    ["live key", { PAYMONGO_TEST_MODE_SECRET_KEY: "sk_live_" + "x".repeat(28) }],
    ["missing webhook secret", { PAYMONGO_TEST_MODE_WEBHOOK_KEY: "" }],
    ["production database connection", { DATABASE_URL: "postgres://example@prod.neon.tech/customer" }],
  ])("rejects %s before any provider network call", async (_name, changes) => {
    let calls = 0;
    await expect(probePayMongoTest({
      environment: { ...valid, ...changes },
      fetchImpl: async () => { calls++; throw new Error("network forbidden"); },
      createCheckout: true,
    })).rejects.toThrow(/^PAYMONGO_TEST_/);
    expect(calls).toBe(0);
  });
  it("proves test credential GET without a checkout side effect", async () => {
    let calls = 0;
    const result = await probePayMongoTest({
      environment: valid,
      fetchImpl: async (url, options) => {
        calls++;
        expect(url).toBe("https://api.paymongo.com/v1/payment_methods");
        expect(options.method).toBe("GET");
        return json({ data: [] });
      },
    });
    expect(calls).toBe(1);
    expect(result).toMatchObject({ status: "PASS", checkout: "NOT_REQUESTED" });
  });
  it("creates a single synthetic test checkout with a redacted result", async () => {
    let calls = 0;
    const result = await probePayMongoTest({
      environment: valid,
      createCheckout: true,
      nonce: () => "test-signed-nonce",
      fetchImpl: async (url, options) => {
        calls++;
        if (calls === 1) return json({ data: [] });
        expect(url).toBe("https://api.paymongo.com/v1/checkout_sessions");
        const body = JSON.parse(options.body ?? "{}");
        expect(body.data.attributes.payment_method_types).toEqual(["qrph"]);
        expect(body.data.attributes.line_items[0].amount).toBe(10000);
        expect(body.data.attributes.send_email_receipt).toBe(false);
        return json({ data: { id: "cs_synthetic", attributes: { checkout_url: "https://checkout.paymongo.com/test", livemode: false } } });
      },
    });
    expect(calls).toBe(2);
    expect(result).toEqual({ status: "PASS", key: "AUTHENTICATED", checkout: "TEST_SESSION_CREATED", webhook: "SECRET_PRESENT_NOT_PROVIDER_VERIFIED" });
  });
  it("does not silently accept a live checkout response", async () => {
    await expect(probePayMongoTest({
      environment: valid,
      createCheckout: true,
      fetchImpl: async (url) => url.endsWith("payment_methods")
        ? json({})
        : json({ data: { id: "cs_test", attributes: { checkout_url: "https://checkout.paymongo.com/test", livemode: true } } }),
    })).rejects.toThrow("PAYMONGO_TEST_CHECKOUT_INVALID_OR_LIVE");
  });
});
