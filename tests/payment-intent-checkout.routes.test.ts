import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  principal: { id: "user_c123456789012345678901234", emailVerified: true, establishedAt: new Date("2025-01-01T00:00:00Z") },
  appGet: vi.fn<(id: string) => unknown>(),
  getApp: vi.fn<() => Promise<unknown>>(),
  requireUser: vi.fn(),
  limit: vi.fn(),
  authorize: vi.fn(),
  findSource: vi.fn(),
  findOrder: vi.fn(),
  findAttempt: vi.fn(),
  binding: vi.fn(),
  matches: vi.fn(),
  createIntent: vi.fn(),
  createMethod: vi.fn(),
  attachMethod: vi.fn(),
  checkoutStart: vi.fn(),
  resolveLegal: vi.fn(),
  commerceIntentStart: vi.fn(),
  env: {
    PROVIDER_CONFIG_SOURCE: "environment",
    PAYMENT_PROVIDER: "mock",
    PAYMONGO_PUBLIC_KEY: undefined as string | undefined,
    PAYMONGO_LIVEMODE: false,
    CLAIM_CODE_CHECKOUT_ENABLED: false,
  },
  ip: "127.0.0.1",
}));

vi.mock("server-only", () => ({}));
vi.mock("@/apps/web/auth/session", () => ({ requireIdentityUser: state.requireUser }));
vi.mock("@/apps/web/runtime", () => ({ getV2WebApplication: state.getApp }));
vi.mock("@/platform/host/env", () => ({ getRuntimeEnvironment: () => state.env }));
vi.mock("@/apps/web/http/request", () => ({ assertSameOrigin: vi.fn(), clientIp: () => state.ip }));
vi.mock("@/apps/web/http/rate-limit", () => ({ rateLimit: state.limit }));
vi.mock("@/apps/web/licensing/self-purchase-continuation", () => ({ resolveSelfPurchaseContinuation: vi.fn(async () => ({ mode: "NEW" })) }));
vi.mock("@/apps/web/commerce/payment-intent-checkout", () => ({
  paymentIntentSourceReference: () => "checkout:pi:opaque",
  paymentIntentRequestFingerprint: () => "commercial-request-fingerprint",
  findBoundPaymentIntentOrderById: state.findOrder,
  findPaymentIntentAttempt: state.findAttempt,
  checkoutBinding: state.binding,
  paymentIntentOrderMatches: state.matches,
  paymentIntentAttemptMatches: (attempt: unknown, expected: unknown) => {
    const a = attempt as Record<string, unknown>; const e = expected as Record<string, unknown>;
    return Object.entries(e).every(([key, value]) => a[key] === value);
  },
  isPaymentIntentCheckoutEnabled: (provider: string | undefined, key: string | undefined) => provider?.trim().toLowerCase() === "paymongo" && Boolean(key?.trim()),
  mayResumePaymentIntentOrder: (status: string) => status === "PENDING",
}));

import { POST as checkoutPost } from "../app/api/checkout/route";
import { POST as statusPost } from "../app/api/checkout/payment-intent-status/route";

const accountId = "22222222-2222-4222-8222-222222222222";
const planId = "33333333-3333-4333-8333-333333333333";
const orderId = "44444444-4444-4444-8444-444444444444";
const legalIds = ["55555555-5555-4555-8555-555555555555", "66666666-6666-4666-8666-666666666666"];
const nonce = "123e4567-e89b-42d3-a456-426614174000";
const sourceReference = "checkout:pi:opaque";

function request(path: string, body: unknown) {
  return new Request("https://shop.example.test" + path, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://shop.example.test" },
    body: JSON.stringify(body),
  });
}
function baseBody(extra: Record<string, unknown> = {}) {
  return { purchasePlanId: planId, customerAccountId: accountId, legalVersionIds: legalIds, ...extra };
}

function configureApp(options: { prior?: boolean; orderStatus?: string; authorized?: boolean } = {}) {
  state.authorize.mockResolvedValue(options.authorized === false
    ? { status: "REJECTED", code: "NOT_FOUND" }
    : { status: "AUTHORIZED", account: { id: accountId, displayName: "Buyer", billingEmail: "buyer@example.test" } });
  state.findOrder.mockResolvedValue({
    id: orderId, accountId, sourceReference, status: options.orderStatus ?? "PENDING", currency: "PHP",
    totalMinor: 7250, subtotalMinor: 7250, taxMinor: 0, fulfillmentMode: "ACCOUNT_ENTITLEMENT",
    renewalSubscriptionId: null, fulfillmentSnapshot: {}, items: [{
      productId: "product_1", priceId: planId, policyId: "edition_1", quantity: 1,
      unitAmountMinor: 7250, totalMinor: 7250, purchasePlanId: planId, planType: "PERPETUAL",
    }],
  });
  state.findAttempt.mockResolvedValue({
    sourceReference, commercialReference: orderId, provider: "paymongo", amountMinor: 7250, currency: "PHP", livemode: false,
  });
  state.findSource.mockResolvedValue(options.prior
    ? { status: "FOUND", value: { orderId: orderId, orderNumber: "BKE-2026-ONE", accountId, sourceReference, status: options.orderStatus ?? "PENDING", currency: "PHP", totalMinor: 7250 } }
    : { status: "NOT_FOUND" });
  state.getApp.mockResolvedValue({
    get: (id: string) => {
      state.appGet(id);
      if (id.includes("reacceptance-status")) return { check: async () => ({ status: "CURRENT" }) };
      if (id.includes("purchase-access")) return { authorize: state.authorize };
      if (id.includes("order-source-lookup")) return { find: state.findSource };
      if (id.includes("checkout-requirements")) return { resolve: state.resolveLegal };
      if (id.includes("legal.acceptance")) return { record: async () => ({ status: "ACCEPTED" }) };
      if (id.includes("payment-intent-checkout")) return { start: state.commerceIntentStart };
      if (id.includes("payment-intent.v1")) return { create: state.createIntent, createPaymentMethod: state.createMethod, attachPaymentMethod: state.attachMethod };
      if (id.includes("purchase-plan-lookup")) return { find: vi.fn(async () => ({ status: "FOUND", plan: { id: planId, active: true, editionId: "edition_1", type: "PERPETUAL", currency: "PHP", amountMinor: 5000, renewalBehavior: "NONE", annualDiscountBps: 0 } })) };
      if (id.includes("purchase-plan-pricing")) return { resolve: () => ({ status: "RESOLVED", pricing: { amountMinor: 5000, billingType: "ONE_TIME", intervalUnit: null, intervalCount: null } }) };
      if (id.includes("catalog.lookup")) return {
        findEditionById: async () => ({ status: "FOUND", value: { id: "edition_1", productId: "product_1", active: true, name: "Edition", features: [], maxUsers: 1, maxDevicesPerUser: 1, updatePolicy: "CURRENT" } }),
        findProductById: async () => ({ status: "FOUND", value: { id: "product_1", active: true, archivedAt: null, available: true, name: "Product" } }),
      };
      if (id.includes("checkout-orchestration")) return { start: state.checkoutStart };
      throw new Error("Unexpected capability lookup: " + id);
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.requireUser.mockResolvedValue(state.principal);
  state.limit.mockResolvedValue({ allowed: true });
  state.resolveLegal.mockResolvedValue({ status: "RESOLVED", requirements: [] });
  state.authorize.mockResolvedValue({ status: "AUTHORIZED", account: { id: accountId, displayName: "Buyer", billingEmail: "buyer@example.test" } });
  state.env.PROVIDER_CONFIG_SOURCE = "environment";
  state.env.PAYMENT_PROVIDER = "mock";
  state.env.PAYMONGO_PUBLIC_KEY = undefined;
  state.env.CLAIM_CODE_CHECKOUT_ENABLED = false;
  process.env.APP_URL = "https://shop.example.test";
  process.env.SUPPORT_EMAIL = "support@example.test";
  process.env.BUSINESS_ADDRESS = "1 Test Street";
  state.binding.mockReturnValue({
    principalId: state.principal.id, accountId, sourceReference,
    requestFingerprint: "commercial-request-fingerprint", planType: "PERPETUAL",
    renewalSubscriptionId: null, purchasePlanId: planId, offerIdentifier: null,
    purchaseFor: "SELF", fulfillmentMode: "ACCOUNT_ENTITLEMENT", currency: "PHP",
    lines: [{ productId: "product_1", priceId: planId, policyId: "edition_1", quantity: 1, purchasePlanId: planId, planType: "PERPETUAL" }],
  });
  state.matches.mockReturnValue(true);
  state.findOrder.mockResolvedValue({
    id: orderId, accountId, sourceReference, status: "PENDING", currency: "PHP",
    totalMinor: 7250, subtotalMinor: 7250, taxMinor: 0, fulfillmentMode: "ACCOUNT_ENTITLEMENT",
    renewalSubscriptionId: null, fulfillmentSnapshot: {}, items: [{
      productId: "product_1", priceId: planId, policyId: "edition_1", quantity: 1,
      unitAmountMinor: 7250, totalMinor: 7250, purchasePlanId: planId, planType: "PERPETUAL",
    }],
  });
  state.createIntent.mockResolvedValue({ status: "READY", value: {
    attemptId: "attempt_1", sourceReference, provider: "paymongo", paymentIntentId: "pi_private",
    clientKey: "client_key_must_not_escape", status: "awaiting_payment_method",
    amountMinor: 7250, currency: "PHP", livemode: false, createdAt: new Date(),
  } });
  state.createMethod.mockResolvedValue({ status: "CREATED", value: { paymentMethodId: "pm_private", type: "qrph" } });
  state.attachMethod.mockResolvedValue({ status: "ATTACHED", value: { paymentIntentId: "pi_private", status: "awaiting_next_action", qrImageUrl: "https://qr.example.test/image.png" } });
  state.checkoutStart.mockResolvedValue({ status: "PAYMENT_REQUIRED", order: { orderId: "legacy_order" }, payment: { checkoutUrl: "https://pay.example.test/hosted" } });
  state.commerceIntentStart.mockResolvedValue({ status: "PAYMENT_INTENT_READY", order: { orderId: "order_new", orderNumber: "BKE-2026-NEW" }, paymentIntent: { attemptId: "attempt_1", sourceReference, provider: "paymongo", paymentIntentId: "pi_private", clientKey: "client_key_must_not_escape", status: "awaiting_payment_method", amountMinor: 5000, currency: "PHP", livemode: false, createdAt: new Date() } });
});

describe("checkout route integration boundary", () => {
  it.each(["mock", "paymongo"] as const)(
    "creates an unbound Claim Code gift through the %s POST checkout owner",
    async (mode) => {
      configureApp();
      state.env.CLAIM_CODE_CHECKOUT_ENABLED = true;
      if (mode === "paymongo") {
        state.env.PAYMENT_PROVIDER = "paymongo";
        state.env.PAYMONGO_PUBLIC_KEY = "pk_test_fixture";
      }
      const response = await checkoutPost(request("/api/checkout", baseBody({
        purchaseFor: "GIFT",
        ...(mode === "paymongo" ? { paymentIntentNonce: nonce } : {}),
      })));
      expect(response.status).toBe(201);
      const start = mode === "paymongo" ? state.commerceIntentStart : state.checkoutStart;
      expect(start).toHaveBeenCalledTimes(1);
      const input = start.mock.calls[0]?.[0] as {
        principalId: string;
        accountId: string;
        order: { fulfillmentMode: string; fulfillmentSnapshot: unknown };
      };
      expect(input.principalId).toBe(state.principal.id);
      expect(input.accountId).toBe(accountId);
      expect(input.order.fulfillmentMode).toBe("CLAIM_CODE");
      expect(JSON.stringify(input)).not.toMatch(/recipientEmail|recipientUserId|recipientAccountId/);
      if (mode === "paymongo") {
        expect(input.order.fulfillmentSnapshot).toMatchObject({
          checkoutBinding: {
            principalId: state.principal.id,
            accountId,
            purchaseFor: "GIFT",
            fulfillmentMode: "CLAIM_CODE",
            sourceReference,
          },
        });
        expect(state.checkoutStart).not.toHaveBeenCalled();
        expect(state.createMethod).toHaveBeenCalledTimes(1);
        expect(state.attachMethod).toHaveBeenCalledTimes(1);
      } else {
        expect(input.order.fulfillmentSnapshot).toEqual({});
        expect(state.commerceIntentStart).not.toHaveBeenCalled();
        expect(state.createMethod).not.toHaveBeenCalled();
      }
    },
  );

  it("keeps a client nonce on the mock/hosted legacy path and never calls Payment Intent capabilities", async () => {
    configureApp();
    const response = await checkoutPost(request("/api/checkout", baseBody({ paymentIntentNonce: nonce })));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ orderId: "legacy_order", checkoutUrl: "https://pay.example.test/hosted" });
    expect(state.appGet.mock.calls.some(([id]) => id.includes("payment-intent.v1"))).toBe(false);
    expect(state.createIntent).not.toHaveBeenCalled();
  });

  it("rejects a direct cross-account status lookup before querying an order", async () => {
    configureApp({ authorized: false });
    const response = await statusPost(request("/api/checkout/payment-intent-status", { orderId: "c567890123456789012345678", customerAccountId: accountId }));
    expect(response.status).toBe(404);
    expect(state.findOrder).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("recovers the canonical saved amount despite changed legal versions and catalog pricing", async () => {
    configureApp({ prior: true, orderStatus: "PENDING" });
    state.env.PAYMENT_PROVIDER = "paymongo";
    state.env.PAYMONGO_PUBLIC_KEY = "pk_test_fixture";
    const response = await checkoutPost(request("/api/checkout", baseBody({ paymentIntentNonce: nonce, legalVersionIds: ["77777777-7777-4777-8777-777777777777", "88888888-8888-4888-8888-888888888888"] })));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ orderId, paymentIntent: { amountMinor: 7250, currency: "PHP", qrImageUrl: "https://qr.example.test/image.png" } });
    expect(state.createIntent).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 7250, currency: "PHP", commercialReference: orderId }));
    expect(state.resolveLegal).toHaveBeenCalledWith(expect.objectContaining({ selectedVersionIds: ["77777777-7777-4777-8777-777777777777", "88888888-8888-4888-8888-888888888888"], planType: "PERPETUAL" }));
    expect(state.appGet.mock.calls.some(([id]) => id.includes("purchase-plan-lookup"))).toBe(false);
    expect(state.appGet.mock.calls.some(([id]) => id.includes("purchase-plan-pricing"))).toBe(false);
    expect(JSON.stringify(body)).not.toContain("client_key_must_not_escape");
  });

  it("fails closed for a bare base-price order whose offer preparation never reached Payments", async () => {
    configureApp({ prior: true, orderStatus: "PENDING" });
    state.env.PAYMENT_PROVIDER = "paymongo";
    state.env.PAYMONGO_PUBLIC_KEY = "pk_test_fixture";
    state.findAttempt.mockResolvedValue(null);
    state.binding.mockReturnValue({
      principalId: state.principal.id, accountId, sourceReference,
      requestFingerprint: "commercial-request-fingerprint", nonceHash: sourceReference.slice("checkout:pi:".length),
      planType: "PERPETUAL", renewalSubscriptionId: null, purchasePlanId: planId,
      offerIdentifier: "offer-previously-rejected", purchaseFor: "SELF",
      fulfillmentMode: "ACCOUNT_ENTITLEMENT", currency: "PHP",
      lines: [{ productId: "product_1", priceId: planId, policyId: "edition_1", quantity: 1, purchasePlanId: planId, planType: "PERPETUAL" }],
    });
    const response = await checkoutPost(request("/api/checkout", baseBody({ paymentIntentNonce: nonce, offerIdentifier: "offer-previously-rejected" })));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "PAYMENT_RECOVERY_REQUIRED", orderId });
    expect(state.createIntent).not.toHaveBeenCalled();
    expect(state.appGet.mock.calls.some(([id]) => id.includes("payment-intent.v1"))).toBe(false);
  });

  it("does not create a Payment Intent for a pending renewal order without its durable attempt", async () => {
    configureApp({ prior: true, orderStatus: "PENDING" });
    state.env.PAYMENT_PROVIDER = "paymongo";
    state.env.PAYMONGO_PUBLIC_KEY = "pk_test_fixture";
    state.binding.mockReturnValue({
      principalId: state.principal.id, accountId, sourceReference,
      requestFingerprint: "commercial-request-fingerprint", nonceHash: sourceReference.slice("checkout:pi:".length),
      planType: "ANNUAL", renewalSubscriptionId: "subscription_saved",
      purchasePlanId: planId, offerIdentifier: null, purchaseFor: "SELF",
      fulfillmentMode: "ACCOUNT_ENTITLEMENT", currency: "PHP",
      lines: [{ productId: "product_1", priceId: planId, policyId: "edition_1", quantity: 1, purchasePlanId: planId, planType: "ANNUAL" }],
    });
    state.findOrder.mockResolvedValue({
      id: orderId, accountId, sourceReference, status: "PENDING", currency: "PHP",
      totalMinor: 7250, subtotalMinor: 7250, taxMinor: 0, fulfillmentMode: "ACCOUNT_ENTITLEMENT",
      renewalSubscriptionId: "subscription_saved", fulfillmentSnapshot: {}, items: [{
        productId: "product_1", priceId: planId, policyId: "edition_1", quantity: 1,
        unitAmountMinor: 7250, totalMinor: 7250, purchasePlanId: planId, planType: "ANNUAL",
      }],
    });
    state.findAttempt.mockResolvedValue(null);
    const response = await checkoutPost(request("/api/checkout", baseBody({ paymentIntentNonce: nonce })));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "PAYMENT_RECOVERY_REQUIRED", orderId });
    expect(state.createIntent).not.toHaveBeenCalled();
    expect(state.appGet.mock.calls.some(([id]) => id.includes("purchase-plan-lookup"))).toBe(false);
  });

  it("requires controlled recovery for a zero-total pending order with no durable attempt", async () => {
    configureApp({ prior: true, orderStatus: "PENDING" });
    state.env.PAYMENT_PROVIDER = "paymongo";
    state.env.PAYMONGO_PUBLIC_KEY = "pk_test_fixture";
    state.findOrder.mockResolvedValue({
      id: orderId, accountId, sourceReference, status: "PENDING", currency: "PHP",
      totalMinor: 0, subtotalMinor: 0, taxMinor: 0, fulfillmentMode: "ACCOUNT_ENTITLEMENT",
      renewalSubscriptionId: null, fulfillmentSnapshot: {}, items: [{
        productId: "product_1", priceId: planId, policyId: "edition_1", quantity: 1,
        unitAmountMinor: 0, totalMinor: 0, purchasePlanId: planId, planType: "PERPETUAL",
      }],
    });
    state.findSource.mockResolvedValue({ status: "FOUND", value: { orderId, orderNumber: "BKE-2026-ZERO", accountId, sourceReference, status: "PENDING", currency: "PHP", totalMinor: 0 } });
    const response = await checkoutPost(request("/api/checkout", baseBody({ paymentIntentNonce: nonce })));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "PAYMENT_RECOVERY_REQUIRED", orderId });
    expect(state.findAttempt).not.toHaveBeenCalled();
    expect(state.createIntent).not.toHaveBeenCalled();
  });

  it("rejects a changed commercial body before invoking any provider capability", async () => {
    configureApp({ prior: true });
    state.env.PAYMENT_PROVIDER = "paymongo";
    state.env.PAYMONGO_PUBLIC_KEY = "pk_test_fixture";
    state.matches.mockReturnValue(false);
    const response = await checkoutPost(request("/api/checkout", baseBody({ paymentIntentNonce: nonce, offerIdentifier: "different" })));
    expect(response.status).toBe(409);
    expect(state.createIntent).not.toHaveBeenCalled();
  });

  it.each(["CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED"])("does not contact provider for a terminal %s order", async (orderStatus) => {
    configureApp({ prior: true, orderStatus });
    state.env.PAYMENT_PROVIDER = "paymongo";
    state.env.PAYMONGO_PUBLIC_KEY = "pk_test_fixture";
    const response = await checkoutPost(request("/api/checkout", baseBody({ paymentIntentNonce: nonce })));
    expect(response.status).toBe(409);
    expect(state.createIntent).not.toHaveBeenCalled();
  });

  it("rate-limits status polling and keeps the error private", async () => {
    configureApp({ prior: true });
    state.limit.mockResolvedValue({ allowed: false });
    const response = await statusPost(request("/api/checkout/payment-intent-status", { orderId: orderId, customerAccountId: accountId }));
    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("vary")).toContain("Cookie");
    expect(state.findOrder).not.toHaveBeenCalled();
  });

  it("normalizes unexpected status database failures to a private 503", async () => {
    configureApp({ prior: true });
    state.findOrder.mockRejectedValue(new Error("private SQL connection detail"));
    const response = await statusPost(request("/api/checkout/payment-intent-status", { orderId: orderId, customerAccountId: accountId }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "CHECKOUT_STATUS_UNAVAILABLE" });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("serves local status without polling the provider", async () => {
    configureApp({ prior: true, orderStatus: "PENDING" });
    const response = await statusPost(request("/api/checkout/payment-intent-status", { orderId: orderId, customerAccountId: accountId }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ orderId: orderId, status: "PENDING" });
    expect(state.createIntent).not.toHaveBeenCalled();
    expect(state.appGet.mock.calls.some(([id]) => id.includes("payment-intent.v1"))).toBe(false);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("returns local paid truth without provider calls", async () => {
    configureApp({ prior: true, orderStatus: "PAID" });
    state.env.PAYMENT_PROVIDER = "paymongo";
    state.env.PAYMONGO_PUBLIC_KEY = "pk_test_fixture";
    const response = await checkoutPost(request("/api/checkout", baseBody({ paymentIntentNonce: nonce })));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ orderId: orderId, paymentConfirmed: true });
    expect(state.createIntent).not.toHaveBeenCalled();
  });

  it("uses same-source recovery after ORDER_CONFLICT and does not create a new order", async () => {
    configureApp();
    state.env.PAYMENT_PROVIDER = "paymongo";
    state.env.PAYMONGO_PUBLIC_KEY = "pk_test_fixture";
    state.commerceIntentStart.mockResolvedValue({ status: "REJECTED", code: "ORDER_CONFLICT" });
    state.findSource.mockReset()
      .mockResolvedValueOnce({ status: "NOT_FOUND" })
      .mockResolvedValueOnce({ status: "FOUND", value: { orderId, orderNumber: "BKE-2026-ONE", accountId, sourceReference, status: "PENDING", currency: "PHP", totalMinor: 7250 } });
    const response = await checkoutPost(request("/api/checkout", baseBody({ paymentIntentNonce: nonce })));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ orderId, paymentIntent: { amountMinor: 7250 } });
    expect(state.commerceIntentStart).toHaveBeenCalledTimes(1);
    expect(state.checkoutStart).not.toHaveBeenCalled();
  });
});
