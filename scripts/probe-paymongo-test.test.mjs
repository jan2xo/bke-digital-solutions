import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertTestModeCredentials, probePayMongoTest } from "./probe-paymongo-test.mjs";

const valid = Object.freeze({
  DEPLOYMENT_ENV: "test",
  PAYMENT_PROVIDER: "paymongo",
  PAYMONGO_LIVEMODE: "false",
  PAYMONGO_TEST_MODE_SECRET_KEY: "sk_test_" + "a".repeat(28),
  PAYMONGO_TEST_MODE_WEBHOOK_KEY: "whsec_" + "b".repeat(32),
});
const response = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

describe("protected PayMongo TEST credentials", () => {
  it("accepts only separate TEST mode credentials", () => {
    assert.deepEqual(assertTestModeCredentials(valid), {
      key: valid.PAYMONGO_TEST_MODE_SECRET_KEY,
      webhookSecret: valid.PAYMONGO_TEST_MODE_WEBHOOK_KEY,
    });
  });
  it("fails closed before network for production, live keys, missing signature secret or DB access", async () => {
    const bad = [
      { DEPLOYMENT_ENV: "production" },
      { DEPLOYMENT_ENV: "staging" },
      { PAYMONGO_LIVEMODE: "true" },
      { PAYMENT_PROVIDER: "mock" },
      { PAYMONGO_TEST_MODE_SECRET_KEY: "sk_live_" + "x".repeat(28) },
      { PAYMONGO_TEST_MODE_SECRET_KEY: "pk_test_" + "x".repeat(28) },
      { PAYMONGO_TEST_MODE_WEBHOOK_KEY: "" },
      { PAYMONGO_TEST_MODE_WEBHOOK_KEY: "short" },
      { DATABASE_URL: "postgres://owner:pass@prod.neon.tech/bke_production" },
      { DIRECT_DATABASE_URL: "postgres://owner:pass@prod.neon.tech/bke_production" },
    ];
    for (const override of bad) {
      let count = 0;
      await assert.rejects(
        () => probePayMongoTest({
          environment: { ...valid, ...override },
          fetchImpl: () => { count++; throw Error("unexpected network"); },
          createCheckout: true,
        }),
        /^Error: PAYMONGO_TEST_/,
      );
      assert.equal(count, 0);
    }
  });
});

describe("protected PayMongo TEST provider probe", () => {
  it("performs authenticated safe GET without creating checkout by default", async () => {
    let count = 0;
    const result = await probePayMongoTest({
      environment: valid,
      fetchImpl: async (url, options) => {
        count++;
        assert.equal(url, "https://api.paymongo.com/v1/payment_methods");
        assert.equal(options.method, "GET");
        assert.equal(options.headers.authorization, "Basic " + Buffer.from(valid.PAYMONGO_TEST_MODE_SECRET_KEY + ":").toString("base64"));
        assert.ok(!options.body);
        return response({ data: [] });
      },
    });
    assert.equal(count, 1);
    assert.deepEqual(result, {
      status: "PASS", key: "AUTHENTICATED", checkout: "NOT_REQUESTED",
      webhook: "SECRET_PRESENT_NOT_PROVIDER_VERIFIED",
    });
  });
  it("creates only one synthetic PayMongo TEST checkout with no real customer and no output URLs", async () => {
    let count = 0;
    const result = await probePayMongoTest({
      environment: valid,
      createCheckout: true,
      nonce: () => "test-accepted-nonce",
      fetchImpl: async (url, options) => {
        count++;
        if (count === 1) {
          assert.equal(options.method, "GET");
          return response({ data: [] });
        }
        assert.equal(url, "https://api.paymongo.com/v1/checkout_sessions");
        assert.equal(options.method, "POST");
        const body = JSON.parse(options.body);
        assert.equal(body.data.attributes.reference_number, "BKE-SANDBOX-testacceptednonce");
        assert.deepEqual(body.data.attributes.payment_method_types, ["qrph"]);
        assert.equal(body.data.attributes.line_items[0].amount, 10000);
        assert.equal(body.data.attributes.billing.email, "paymongo-test@bke.test");
        assert.equal(body.data.attributes.send_email_receipt, false);
        assert.equal(options.headers["idempotency-key"], body.data.attributes.reference_number);
        assert.ok(!options.body.includes("sk_test_"));
        return response({
          data: { id: "cs_safe_synthetic", attributes: { checkout_url: "https://checkout.paymongo.com/synthetic", livemode: false } },
        });
      },
    });
    assert.equal(count, 2);
    assert.equal(result.checkout, "TEST_SESSION_CREATED");
    assert.equal(result.webhook, "SECRET_PRESENT_NOT_PROVIDER_VERIFIED");
  });
  it("rejects authentication failure, provider failures and live-mode checkout responses", async () => {
    await assert.rejects(() => probePayMongoTest({ environment: valid, fetchImpl: async () => response({}, 401) }), {
      message: "PAYMONGO_TEST_KEY_REJECTED",
    });
    await assert.rejects(() => probePayMongoTest({ environment: valid, fetchImpl: async () => response({}, 500) }), {
      message: "PAYMONGO_TEST_AUTH_HTTP_500",
    });
    await assert.rejects(() => probePayMongoTest({
      environment: valid,
      createCheckout: true,
      fetchImpl: async (url) => url.endsWith("payment_methods")
        ? response({})
        : response({ data: { id: "cs_test", attributes: { checkout_url: "https://checkout.paymongo.com/test", livemode: true } } }),
    }), { message: "PAYMONGO_TEST_CHECKOUT_INVALID_OR_LIVE" });
  });
});
