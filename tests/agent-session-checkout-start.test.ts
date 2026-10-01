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

  it("binds mutation identity to the durable Agent device and correlation id", () => {
    const route = readFileSync(routePath, "utf8");

    expect(route).toContain("durableAgentCheckoutSourceReference");
    expect(route).toContain("durableAgentCheckoutSourceReference(");
    expect(route).toContain("session,");
    expect(route).toContain("input.correlation_id");
    expect(route).not.toContain("`agent-checkout:${session.sessionId}:${input.correlation_id}`");
    expect(route).toContain("sourceReference,");
    expect(route).toContain("paymentSourceReference: sourceReference");
  });

  it("preserves the account-session protocol on owned checkout failures", () => {
    const route = readFileSync(routePath, "utf8");

    expect(route).toContain("error instanceof CheckoutStartHttpError");
    expect(route).toContain("return json({ error: error.code }, error.status)");
  });

  it("returns only server-created order and secure checkout navigation", () => {
    const route = readFileSync(routePath, "utf8");

    expect(route).toContain("order_id: checkoutResult.order.orderId");
    expect(route).toContain("checkoutResult.payment.checkoutUrl");
    expect(route).toContain("complimentary: false");
    expect(route).toContain("complimentary: true");
  });
});


describe("Agent-session Store self-service trial start", () => {
  const routePath =
    "app/api/agent-sessions/store/trials/start/route.ts";

  it("keeps trial mutation behind the Agent Store account-session boundary", () => {
    const route = readFileSync(routePath, "utf8");

    expect(route).toContain("rejectBrowserOriginForAgent(request)");
    expect(route).toContain("requireAgentAccountSessionProtocol(request)");
    expect(route).toContain("authenticateAgentAccessToken");
    expect(route).toContain('request.headers.get("authorization")');
    expect(route).toContain('"cache-control": "no-store"');
    expect(route).toContain("AGENT_ACCOUNT_SESSION_ENABLED");
  });

  it("accepts only correlation and the catalog edition identity already exposed to BKE", () => {
    const route = readFileSync(routePath, "utf8");
    const schema = route.slice(
      route.indexOf("const schema"),
      route.indexOf("function bearerToken"),
    );

    expect(schema).toContain("correlation_id:");
    expect(schema).toContain("edition_id:");
    for (const forbidden of [
      "account_id:",
      "customer_account_id:",
      "user_id:",
      "trial_id:",
      "license_id:",
      "order_id:",
      "grace_days:",
      "payment",
      "recipient",
    ]) {
      expect(schema).not.toContain(forbidden);
    }
  });

  it("revalidates identity, Legal, and selected-account purchase authority server-side", () => {
    const route = readFileSync(routePath, "utf8");

    expect(route).toContain("IDENTITY_LOOKUP_CAPABILITY_ID");
    expect(route).toContain("principal.emailVerified");
    expect(route).toContain('principal.lifecycleState !== "ACTIVE"');
    expect(route).toContain("LEGAL_REACCEPTANCE_STATUS_CAPABILITY_ID");
    expect(route).toContain("ACCOUNTS_PURCHASE_ACCESS_CAPABILITY_ID");
    expect(route).toContain("accountId: session.accountId");
    expect(route).toContain("principalId: principal.id");
    expect(route).not.toContain("input.account");
  });

  it("delegates exactly once to the existing transactional Trials authority", () => {
    const route = readFileSync(routePath, "utf8");

    expect(route.match(/grantProductTrial\(/g)).toHaveLength(1);
    expect(route).toContain('source: "SELF_SERVICE"');
    expect(route).toContain("accountId: access.account.id");
    expect(route).toContain("editionId: input.edition_id");
    expect(route).toContain("actorId: principal.id");
    expect(route).not.toContain("db.trialGrant.create");
    expect(route).not.toContain("db.license.create");
    expect(route).not.toContain("db.order.create");
  });

  it("returns no raw entitlement, trial, account, user, or order identifiers", () => {
    const route = readFileSync(routePath, "utf8");
    const success = route.slice(
      route.indexOf('status: "started"'),
      route.indexOf("      201,", route.indexOf('status: "started"')),
    );

    expect(success).toContain("correlation_id: input.correlation_id");
    expect(success).toContain("trial_ends_at:");
    expect(success).toContain("grace_ends_at:");
    for (const forbidden of [
      "trial_id",
      "license_id",
      "order_id",
      "account_id",
      "user_id",
      "checkout_url",
      "claim_code",
    ]) {
      expect(success).not.toContain(forbidden);
    }
  });

  it("preserves the existing one-trial policy and version-free configuration boundary", () => {
    const route = readFileSync(routePath, "utf8");
    const service = readFileSync(
      "apps/web/trials/service.ts",
      "utf8",
    );

    expect(service).toContain("assertSelfServiceTrialAvailable");
    expect(service).toContain("selfServiceYear");
    expect(service).toContain("createTrialGrantPlan");
    expect(route).not.toContain("V2_");
    expect(route).not.toContain("V3_");
  });
});
