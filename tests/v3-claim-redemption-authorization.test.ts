import { describe, expect, it } from "vitest";
import { roleHasCapability } from "@/lib/authorization";

describe("V3 claim redemption authorization", () => {
  it("allows commercial and licensing managers to claim into an account", () => {
    expect(roleHasCapability("OWNER", "CLAIM_ENTITLEMENT")).toBe(true);
    expect(roleHasCapability("BILLING", "CLAIM_ENTITLEMENT")).toBe(true);
    expect(roleHasCapability("LICENSE_MANAGER", "CLAIM_ENTITLEMENT")).toBe(true);
  });

  it("does not let a plain member move a claimable right into the organization", () => {
    expect(roleHasCapability("MEMBER", "CLAIM_ENTITLEMENT")).toBe(false);
  });
});
