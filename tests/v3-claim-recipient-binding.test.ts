import { describe, expect, it } from "vitest";
import {
  claimRecipientMatches,
  normalizeClaimRecipientEmail,
  validClaimRecipientEmail,
} from "@/apps/web/entitlements/claim-recipient-email";

describe("V3 claim recipient email binding", () => {
  it("normalizes recipient email for durable pending-claim matching", () => {
    expect(normalizeClaimRecipientEmail("  Person@Example.COM ")).toBe("person@example.com");
  });

  it("matches the signed-in verified email case-insensitively", () => {
    expect(claimRecipientMatches("person@example.com", "PERSON@example.com")).toBe(true);
    expect(claimRecipientMatches("person@example.com", "other@example.com")).toBe(false);
  });

  it("keeps legacy unbound claim codes redeemable", () => {
    expect(claimRecipientMatches(null, "person@example.com")).toBe(true);
  });

  it("rejects malformed recipient addresses before claim issuance", () => {
    expect(validClaimRecipientEmail("not-an-email")).toBe(false);
    expect(validClaimRecipientEmail("person@example.com")).toBe(true);
  });
});
