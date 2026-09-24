import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = () =>
  readFileSync(
    "app/api/agent-sessions/store/checkout-review/route.ts",
    "utf8",
  );

describe("Agent Store checkout review authority", () => {
  it("keeps review behind the authenticated Agent account session", () => {
    const route = source();

    expect(route).toContain("authenticateAgentAccessToken");
    expect(route).toContain("requireAgentAccountSessionProtocol");
    expect(route).toContain("rejectBrowserOriginForAgent");
    expect(route).toContain("session.userId");
    expect(route).toContain("session.accountId");
  });

  it("rechecks identity, purchase authority, Legal state, Catalog, and Commerce pricing", () => {
    const route = source();

    for (const required of [
      "IDENTITY_LOOKUP_CAPABILITY_ID",
      "ACCOUNTS_PURCHASE_ACCESS_CAPABILITY_ID",
      "LEGAL_REACCEPTANCE_STATUS_CAPABILITY_ID",
      "COMMERCE_PURCHASE_PLAN_LOOKUP_CAPABILITY_ID",
      "COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID",
      "CATALOG_LOOKUP_CAPABILITY_ID",
      "LEGAL_CHECKOUT_REQUIREMENTS_CAPABILITY_ID",
      "pricing.resolve(plan)",
      "purchaseAccess.authorize",
      "legal.resolve",
    ]) {
      expect(route).toContain(required);
    }
  });

  it("lets Launcher choose only a plan, never an arbitrary destination account", () => {
    const route = source();

    expect(route).toContain("purchase_plan_id");
    expect(route).toContain("accountId: session.accountId");
    expect(route).not.toContain("customer_account_id");
    expect(route).not.toContain("customerAccountId");
  });

  it("returns native review facts without creating checkout/payment state", () => {
    const route = source();

    for (const required of [
      "purchase_modes",
      "legal_documents",
      "document_version_id",
      "amount_minor",
      "billing_type",
      "renewal_behavior",
      "legal_reacceptance_required",
    ]) {
      expect(route).toContain(required);
    }

    for (const forbidden of [
      "COMMERCE_CHECKOUT_ORCHESTRATION_CAPABILITY_ID",
      "checkoutResult",
      "payment.checkoutUrl",
      "checkoutUrl",
      "PAYMONGO",
      "paymentSourceReference",
      "acceptance.record",
      "orderId",
    ]) {
      expect(route).not.toContain(forbidden);
    }
  });

  it("keeps gift purchase rollout version-free", () => {
    const route = source();

    expect(route).toContain("CLAIM_CODE_CHECKOUT_ENABLED");
    expect(route).toContain('["SELF", "GIFT"]');
    expect(route).not.toContain("V2_CLAIM_CODE");
    expect(route).not.toContain("V3_CLAIM_CODE");
  });
});
