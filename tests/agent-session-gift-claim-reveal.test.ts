import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = () =>
  readFileSync("app/api/agent-sessions/store/gift-claim-code/route.ts", "utf8");

describe("Agent Store GIFT Claim Code reveal", () => {
  it("keeps Claim Code reveal behind the durable Agent account session", () => {
    const source = route();

    expect(source).toContain("authenticateAgentAccessToken");
    expect(source).toContain("requireAgentAccountSessionProtocol");
    expect(source).toContain("rejectBrowserOriginForAgent");
    expect(source).toContain("session.userId");
    expect(source).toContain("session.accountId");
    expect(source).toContain('"MANAGE_CLAIM_CODES"');
    expect(source).toContain('"cache-control": "no-store"');
  });

  it("binds reveal to same-device recovery candidates and purchaser account", () => {
    const source = route();

    expect(source).toContain("agentCheckoutSourceReferenceCandidates");
    expect(source).toContain("for (const candidate of sourceReferences)");
    expect(source).toContain("sourceReference: candidate");
    expect(source).toContain("order.sourceReference !== sourceReference");
    expect(source).toContain("order.accountId !== session.accountId");
    expect(source).toContain('order.fulfillmentMode !== "CLAIM_CODE"');
    expect(source).toContain('"purchaserAccountId" = ${session.accountId}');
  });

  it("reveals only after payment authority says the gift is settled", () => {
    const source = route();

    expect(source).toContain("order.totalMinor > 0 && order.paidAt === null");
    expect(source).toContain('"not_ready"');
    expect(source).toContain('"fulfillment_pending"');
    expect(source).toContain("revealClaimCode");
    expect(source).toContain('"available"');
  });

  it("does not re-run checkout, payment mutation, or Claim Code issuance", () => {
    const source = route();

    expect(source).not.toContain("checkout.start");
    expect(source).not.toContain("StartStoreCheckout");
    expect(source).not.toContain("issueClaimCodes");
    expect(source).not.toContain("recipientEmail");
    expect(source).not.toContain("CLAIM_CODE_CHECKOUT_ENABLED");
    expect(source).not.toContain("V2_");
    expect(source).not.toContain("V3_");
  });

  it("preserves fail-closed terminal and authority outcomes", () => {
    const source = route();

    expect(source).toContain('"not_found"');
    expect(source).toContain('"cancelled"');
    expect(source).toContain('"account_forbidden"');
    expect(source).toContain('"account_not_found"');
    expect(source).toContain('"claim_code_not_found"');
    expect(source).toContain('"claim_code_already_used"');
    expect(source).toContain('"claim_code_revoked"');
    expect(source).toContain('"claim_code_expired"');
    expect(source).toContain('"CLAIM_CODE_CARDINALITY_CONFLICT"');
    expect(source).toContain('"INVALID_TOKEN"');
    expect(source).toContain('"RATE_LIMITED"');
  });

  it("audits secret reveal through the Agent session channel", () => {
    const source = route();

    expect(source).toContain('"CLAIM_CODE_REVEALED"');
    expect(source).toContain('"BKE_AGENT_SESSION"');
    expect(source).toContain("session.sessionId");
    expect(source).toContain("session.deviceId");
    expect(source).toContain("correlationId: input.correlation_id");
  });
});


describe("Agent Store persistent gift Claim Code management", () => {
  const list = () =>
    readFileSync(
      "app/api/agent-sessions/store/gift-claim-codes/route.ts",
      "utf8",
    );
  const reveal = () =>
    readFileSync(
      "app/api/agent-sessions/store/gift-claim-codes/reveal/route.ts",
      "utf8",
    );
  const handles = () =>
    readFileSync(
      "apps/web/agent-sessions/gift-claim-handles.ts",
      "utf8",
    );

  it("lists persistent gift metadata through selected-account Agent authority only", () => {
    const source = list();

    expect(source).toContain("authenticateAgentAccessToken");
    expect(source).toContain("requireAgentAccountSessionProtocol");
    expect(source).toContain("rejectBrowserOriginForAgent");
    expect(source).toContain("assertLegalAcceptanceCurrent(session.userId)");
    expect(source).toContain('"MANAGE_CLAIM_CODES"');
    expect(source).toContain('"purchaserAccountId" = ${session.accountId}');
    expect(source).toContain("LIMIT 100");
    expect(source).toContain("giftClaimHandle(");
    expect(source).toContain("gift_claim_handle:");
    expect(source).not.toContain("claim_code:");
    expect(source).not.toContain("recipientEmail");
  });

  it("uses a purpose-specific opaque HMAC handle instead of raw ClaimCode IDs", () => {
    const source = handles();

    expect(source).toContain('PREFIX = "bke-gift-claim-v1_"');
    expect(source).toContain("createHmac");
    expect(source).toContain('"bke-gift-claim-v1\\0"');
    expect(source).toContain("timingSafeEqual");
    expect(source).toContain("purchaserAccountId");
    expect(source).not.toContain("encryptClaimCode");
    expect(source).not.toContain("decryptClaimCode");
  });

  it("requires the exact Agent session to be recently authenticated before persistent secret reveal", () => {
    const source = reveal();

    expect(source).toContain("authenticateAgentAccessToken");
    expect(source).toContain("agentSessionRecentlyAuthenticated(session)");
    expect(source).toContain('"recent_auth_required"');
    expect(source).toContain("assertLegalAcceptanceCurrent(session.userId)");
    expect(source).toContain('"MANAGE_CLAIM_CODES"');
    expect(source).toContain("account.lifecycleState");
    expect(source).toContain("giftClaimHandleMatches(");
    expect(source).toContain("revealClaimCode");
    expect(source).toContain('"BKE_AGENT_SESSION_PERSISTENT_GIFT"');
  });

  it("returns plaintext only from the explicit reveal response and never returns raw cloud identifiers", () => {
    const listSource = list();
    const revealSource = reveal();

    expect(listSource).not.toContain("claim_code:");
    expect(revealSource).toContain("claim_code: result.claimCode");
    expect(revealSource).toContain(
      "gift_claim_handle: input.gift_claim_handle",
    );

    const publicResponse = revealSource.slice(
      revealSource.indexOf('case "available":'),
      revealSource.indexOf('case "rejected":'),
    );
    for (const forbidden of [
      "claim_code_id",
      "order_id",
      "account_id",
      "user_id",
      "license_id",
      "entitlement_id",
    ]) {
      expect(publicResponse).not.toContain(forbidden);
    }
  });

  it("preserves terminal Claim Code outcomes and does not mutate commerce or issuance", () => {
    const source = reveal();

    expect(source).toContain('"claim_code_not_found"');
    expect(source).toContain('"claim_code_already_used"');
    expect(source).toContain('"claim_code_revoked"');
    expect(source).toContain('"claim_code_expired"');
    expect(source).not.toContain("issueClaimCodes");
    expect(source).not.toContain("checkout");
    expect(source).not.toContain("payment");
    expect(source).not.toContain("recipientEmail");
    expect(source).not.toContain("V2_");
    expect(source).not.toContain("V3_");
  });
});
