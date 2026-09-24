import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Agent-session Store checkout start", () => {
  const routePath = "app/api/agent-sessions/store/checkout-start/route.ts";

  it("requires the Agent account-session trust boundary", () => {
    const route = readFileSync(routePath, "utf8");

    expect(route).toContain("rejectBrowserOriginForAgent(request)");
    expect(route).toContain("requireAgentAccountSessionProtocol(request)");
    expect(route).toContain("authenticateAgentAccessToken");
    expect(route).toContain('request.headers.get("authorization")');
  });

  it("accepts only narrow purchase intent from BKE", () => {
    const route = readFileSync(routePath, "utf8");
    const schema = route.slice(
      route.indexOf("const checkoutStartSchema"),
      route.indexOf("class CheckoutStartHttpError"),
    );

    expect(schema).toContain("correlation_id:");
    expect(schema).toContain("purchase_plan_id:");
    expect(schema).toContain('purchase_mode: z.enum(["SELF", "GIFT"])');
    expect(schema).toContain("legal_version_ids:");
    expect(schema).not.toContain("customer_account_id:");
    expect(schema).not.toContain("account_id:");
    expect(schema).not.toContain("amount_minor:");
    expect(schema).not.toContain("checkout_url:");
    expect(schema).not.toContain("recipientEmail");
  });

  it("binds purchase authority to the authenticated Agent session account", () => {
    const route = readFileSync(routePath, "utf8");

    expect(route).toContain("accountId: session.accountId");
    expect(route).toContain("principalId: principal.id");
    expect(route).not.toContain("input.customerAccountId");
  });

  it("re-resolves canonical plan, pricing, catalog and Legal at mutation time", () => {
    const route = readFileSync(routePath, "utf8");

    expect(route).toContain("COMMERCE_PURCHASE_PLAN_LOOKUP_CAPABILITY_ID");
    expect(route).toContain("COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID");
    expect(route).toContain("CATALOG_LOOKUP_CAPABILITY_ID");
    expect(route).toContain("LEGAL_CHECKOUT_REQUIREMENTS_CAPABILITY_ID");
    expect(route).toContain("LEGAL_ACCEPTANCE_CAPABILITY_ID");
    expect(route).toContain("selectedVersionIds: input.legal_version_ids");
  });

  it("keeps gift checkout as an unbound Claim Code purchase", () => {
    const route = readFileSync(routePath, "utf8");

    expect(route).toContain("CLAIM_CODE_CHECKOUT_ENABLED");
    expect(route).toContain('input.purchase_mode === "GIFT"');
    expect(route).toContain('fulfillmentMode: giftPurchase ? "CLAIM_CODE" : "ACCOUNT_ENTITLEMENT"');
    expect(route).toContain("fulfillmentSnapshot: {}");
    expect(route).not.toContain("recipient_email");
    expect(route).not.toContain("verifiedEmail");
  });

  it("delegates payment creation to Commerce without provider authority in the route", () => {
    const route = readFileSync(routePath, "utf8");

    expect(route).toContain("COMMERCE_CHECKOUT_ORCHESTRATION_CAPABILITY_ID");
    expect(route).toContain("checkout.start({");
    expect(route).not.toContain("PayMongo");
    expect(route).not.toContain("PAYMONGO");
    expect(route).not.toContain("createCheckoutSession");
  });

  it("binds mutation identity to the Agent session and correlation id", () => {
    const route = readFileSync(routePath, "utf8");

    expect(route).toContain(
      "paymentSourceReference: `agent-checkout:${session.sessionId}:${input.correlation_id}`",
    );
  });

  it("returns only server-created order and secure checkout navigation", () => {
    const route = readFileSync(routePath, "utf8");

    expect(route).toContain("order_id: checkoutResult.order.orderId");
    expect(route).toContain("checkoutResult.payment.checkoutUrl");
    expect(route).toContain("complimentary: false");
    expect(route).toContain("complimentary: true");
  });
});
