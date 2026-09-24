import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = () =>
  readFileSync("app/api/agent-sessions/claims/redeem/route.ts", "utf8");

describe("Agent account-session Claim Code redemption", () => {
  it("keeps cloud Claim Code authority in Digital Solutions behind the Agent session", () => {
    const source = route();

    expect(source).toContain("authenticateAgentAccessToken");
    expect(source).toContain("requireAgentAccountSessionProtocol");
    expect(source).toContain("rejectBrowserOriginForAgent");
    expect(source).toContain("requireClaimAccountCapabilityInTransaction");
    expect(source).toContain('"CLAIM_ENTITLEMENT"');
    expect(source).toContain("consumeClaimCode");
    expect(source).toContain('"CLAIM_CODE_REDEEMED"');
    expect(source).toContain('"BKE_AGENT_SESSION"');
  });

  it("binds redemption to the account already authorized for the durable Agent session", () => {
    const source = route();

    expect(source).toContain("session.userId");
    expect(source).toContain("session.accountId");
    expect(source).toContain("accountId: session.accountId");
    expect(source).not.toContain("customer_account_id");
    expect(source).not.toContain("customerAccountId");
  });

  it("does not turn the Agent endpoint into a browser session or sales feature gate", () => {
    const source = route();

    expect(source).not.toContain("requireIdentityUser");
    expect(source).not.toContain("cookies()");
    expect(source).not.toContain("CLAIM_CODE_CHECKOUT_ENABLED");
    expect(source).not.toContain("V2_");
    expect(source).not.toContain("V3_");
  });

  it("preserves fail-closed Claim Code outcomes for BKE UX", () => {
    const source = route();

    expect(source).toContain('"claim_code_not_found"');
    expect(source).toContain('"claim_code_already_used"');
    expect(source).toContain('"claim_code_revoked"');
    expect(source).toContain('"claim_code_expired"');
    expect(source).toContain('"INVALID_TOKEN"');
    expect(source).toContain('"RATE_LIMITED"');
  });
});
