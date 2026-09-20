import { describe, expect, it } from "vitest";
import { roleHasClaimAccountCapability } from "@/apps/web/accounts/claim-code-authorization";

describe("V3 claim redemption authorization", () => {
  it("allows commercial and licensing managers to claim into an account", () => {
    expect(roleHasClaimAccountCapability("OWNER", "CLAIM_ENTITLEMENT")).toBe(true);
    expect(roleHasClaimAccountCapability("BILLING", "CLAIM_ENTITLEMENT")).toBe(true);
    expect(roleHasClaimAccountCapability("LICENSE_MANAGER", "CLAIM_ENTITLEMENT")).toBe(true);
  });

  it("does not let a plain member move a claimable right into the organization", () => {
    expect(roleHasClaimAccountCapability("MEMBER", "CLAIM_ENTITLEMENT")).toBe(false);
  });
});
