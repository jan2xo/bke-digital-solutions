import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { opaqueEntityIdSchema } from "../apps/web/http/validation";
import {
  isPaymentIntentCheckoutEnabled,
  mayResumePaymentIntentOrder,
  paymentIntentAttemptMatches,
  paymentIntentOrderMatches,
  paymentIntentRequestFingerprint,
  paymentIntentSourceReference,
} from "../apps/web/commerce/payment-intent-checkout";

const nonce = "123e4567-e89b-42d3-a456-426614174000";
const lines = [{ productId: "prod", priceId: "price", policyId: "edition", quantity: 1, unitAmountMinor: 900, totalMinor: 900, purchasePlanId: "plan", planType: "ANNUAL" }];
function pendingOrder() {
  return {
    id: "order", accountId: "acct", sourceReference: paymentIntentSourceReference("principal", "acct", nonce),
    status: "PENDING" as const, currency: "PHP", totalMinor: 900, subtotalMinor: 900, taxMinor: 0, fulfillmentMode: "ACCOUNT_ENTITLEMENT" as const,
    renewalSubscriptionId: null, items: lines,
    fulfillmentSnapshot: { checkoutBinding: {
      principalId: "principal", accountId: "acct", sourceReference: paymentIntentSourceReference("principal", "acct", nonce),
      nonceHash: paymentIntentSourceReference("principal", "acct", nonce).slice("checkout:pi:".length), requestFingerprint: paymentIntentRequestFingerprint({ principalId: "principal", accountId: "acct", purchasePlanId: "plan", offerIdentifier: null, purchaseFor: "SELF" }),
      purchasePlanId: "plan", offerIdentifier: null, purchaseFor: "SELF",
      fulfillmentMode: "ACCOUNT_ENTITLEMENT", renewalSubscriptionId: null, currency: "PHP", lines,
    } },
  };
}

describe("first-party Payment Intent checkout boundaries", () => {
  it("accepts opaque CUID and UUID entity identifiers while rejecting SQL syntax", () => {
    expect(opaqueEntityIdSchema.safeParse("c123456789012345678901234").success).toBe(true);
    expect(opaqueEntityIdSchema.safeParse("33333333-3333-4333-8333-333333333333").success).toBe(true);
    expect(opaqueEntityIdSchema.safeParse("x'; DROP TABLE Order;--").success).toBe(false);
  });

  it("enables only for the server configured PayMongo provider and public key", () => {
    expect(isPaymentIntentCheckoutEnabled("paymongo", "pk_test_key")).toBe(true);
    expect(isPaymentIntentCheckoutEnabled("mock", "pk_test_key")).toBe(false);
    expect(isPaymentIntentCheckoutEnabled("paymongo", undefined)).toBe(false);
    expect(isPaymentIntentCheckoutEnabled(undefined, "pk_test_key")).toBe(false);
  });

  it("keeps one nonce mapped to one opaque stable source, scoped to principal and account", () => {
    const source = paymentIntentSourceReference("principal", "acct", nonce);
    expect(source).toBe(paymentIntentSourceReference("principal", "acct", nonce));
    expect(source).not.toContain("principal");
    expect(source).not.toContain("acct");
    expect(source).not.toBe(paymentIntentSourceReference("principal", "other", nonce));
  });

  it("rejects changed commercial requests and cross-account/principal order reads", () => {
    const order = pendingOrder();
    const same = { principalId: "principal", accountId: "acct", purchasePlanId: "plan", offerIdentifier: null, purchaseFor: "SELF" as const };
    const expected = { principalId: same.principalId, accountId: same.accountId, sourceReference: order.sourceReference,
      requestFingerprint: paymentIntentRequestFingerprint(same), purchasePlanId: same.purchasePlanId, offerIdentifier: same.offerIdentifier, purchaseFor: same.purchaseFor };
    expect(paymentIntentOrderMatches(order, expected)).toBe(true);
    expect(paymentIntentOrderMatches(order, { ...expected, principalId: "attacker" })).toBe(false);
    expect(paymentIntentOrderMatches(order, { ...expected, accountId: "other" })).toBe(false);
    expect(paymentIntentOrderMatches(order, { ...expected, requestFingerprint: paymentIntentRequestFingerprint({ ...same, offerIdentifier: "other-offer" }) })).toBe(false);
    expect(paymentIntentOrderMatches({ ...order, items: [{ ...order.items[0], totalMinor: 899 }] }, expected)).toBe(false);
  });

  it("does not bind retries to changed legal selections, renewal discovery, or live catalog pricing", () => {
    const original = { principalId: "principal", accountId: "acct", purchasePlanId: "plan", offerIdentifier: null, purchaseFor: "SELF" as const, legalVersionIds: ["old-a", "old-b"], renewalDiscoveredNow: null, liveCatalogAmountMinor: 900 };
    const retry = { ...original, legalVersionIds: ["new-a", "new-b"], renewalDiscoveredNow: "new-current-subscription", liveCatalogAmountMinor: 1200 };
    expect(paymentIntentRequestFingerprint(original)).toBe(paymentIntentRequestFingerprint(retry));
    expect(pendingOrder().totalMinor).toBe(900);
  });

  it("requires durable Payment Intent evidence to match source, order, provider mode, amount, and currency", () => {
    const attempt = { sourceReference: "checkout:pi:opaque", commercialReference: "order", provider: "paymongo", livemode: false, amountMinor: 900, currency: "php" };
    const expected = { sourceReference: attempt.sourceReference, commercialReference: "order", provider: "paymongo", livemode: false, amountMinor: 900, currency: "PHP" };
    expect(paymentIntentAttemptMatches(attempt, expected)).toBe(true);
    expect(paymentIntentAttemptMatches({ ...attempt, amountMinor: 901 }, expected)).toBe(false);
    expect(paymentIntentAttemptMatches({ ...attempt, livemode: true }, expected)).toBe(false);
    expect(paymentIntentAttemptMatches({ ...attempt, commercialReference: "other-order" }, expected)).toBe(false);
  });

  it("permits provider recovery only while the canonical order is pending", () => {
    expect(mayResumePaymentIntentOrder("PENDING")).toBe(true);
    expect(mayResumePaymentIntentOrder("PAID")).toBe(false);
    expect(mayResumePaymentIntentOrder("CANCELLED")).toBe(false);
    expect(mayResumePaymentIntentOrder("REFUNDED")).toBe(false);
    expect(mayResumePaymentIntentOrder("PARTIALLY_REFUNDED")).toBe(false);
  });
});
