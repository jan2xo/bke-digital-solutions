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
