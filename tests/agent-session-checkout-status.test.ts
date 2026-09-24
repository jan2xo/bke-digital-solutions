import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Agent-session Store checkout status", () => {
  const routePath = "app/api/agent-sessions/store/checkout-status/route.ts";

  it("keeps recovery behind the Agent account-session trust boundary", () => {
    const route = readFileSync(routePath, "utf8");

    expect(route).toContain("rejectBrowserOriginForAgent(request)");
    expect(route).toContain("requireAgentAccountSessionProtocol(request)");
    expect(route).toContain("authenticateAgentAccessToken");
    expect(route).toContain('request.headers.get("authorization")');
    expect(route).toContain("IDENTITY_LOOKUP_CAPABILITY_ID");
  });

  it("accepts only the original checkout correlation identifier", () => {
    const route = readFileSync(routePath, "utf8");
    const schema = route.slice(
      route.indexOf("const checkoutStatusSchema"),
      route.indexOf("class CheckoutStatusHttpError"),
    );

    expect(schema).toContain("correlation_id:");
    expect(schema).not.toContain("account_id:");
    expect(schema).not.toContain("order_id:");
    expect(schema).not.toContain("purchase_plan_id:");
    expect(schema).not.toContain("amount_minor:");
    expect(schema).not.toContain("provider:");
    expect(route).toContain('key !== "correlation_id"');
  });

  it("reconstructs the exact durable source from authenticated session plus correlation", () => {
    const route = readFileSync(routePath, "utf8");

    expect(route).toContain(
      "`agent-checkout:${session.sessionId}:${input.correlation_id}`",
    );
    expect(route).toContain("COMMERCE_ORDER_SOURCE_LOOKUP_CAPABILITY_ID");
    expect(route).toContain("PAYMENTS_CHECKOUT_ATTEMPT_LOOKUP_CAPABILITY_ID");
    expect(route).toContain("order.accountId !== session.accountId");
    expect(route).toContain(
      "paymentResult.value.commercialReference !== order.orderId",
    );
  });

  it("is read-only and never retries or recreates checkout", () => {
    const route = readFileSync(routePath, "utf8");

    for (const forbidden of [
      "checkout.start(",
      "paymentCheckout.create(",
      "acceptance.record(",
      "COMMERCE_CHECKOUT_ORCHESTRATION_CAPABILITY_ID",
      "PAYMONGO",
      "purchase_plan_id",
    ]) {
      expect(route).not.toContain(forbidden);
    }
  });

  it("returns only recovery state and an already-created pending checkout target", () => {
    const route = readFileSync(routePath, "utf8");

    for (const required of [
      'status: "not_found"',
      'status: "found"',
      "order_id:",
      "order_number:",
      "order_status:",
      "fulfillment_mode:",
      "payment_status:",
      "checkout_url:",
      "paid_at:",
      'order.status === "PENDING"',
      'paymentResult.value.status === "PENDING"',
    ]) {
      expect(route).toContain(required);
    }

    for (const forbidden of [
      "externalCheckoutId",
      "provider:",
      "payer:",
      "billingSnapshot",
      "customerSnapshot",
    ]) {
      expect(route).not.toContain(forbidden);
    }
  });

  it("preserves the Agent protocol even for unexpected recovery failures", () => {
    const route = readFileSync(routePath, "utf8");

    expect(route).toContain("const response = apiError(error)");
    expect(route).toContain(
      '"x-bke-account-session-version"',
    );
    expect(route).toContain("AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION");
  });
});
