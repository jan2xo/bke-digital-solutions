import { describe, expect, it } from "vitest";
import { isUnapprovedLegalReviewDraft, isCheckoutLegalNoticeAllowed } from "../apps/web/legal/review-draft-policy";

describe("checkout legal review-draft publication guard", () => {
  it("rejects explicitly labeled drafts regardless of an administrator publishing them", () => {
    expect(isUnapprovedLegalReviewDraft("Software License Agreement - REVIEW DRAFT", "# License\nWords")).toBe(true);
    expect(isUnapprovedLegalReviewDraft("Refund Policy", "# Refund Policy - REVIEW DRAFT\n\nText")).toBe(true);
    expect(isUnapprovedLegalReviewDraft("Refund Policy", "# Refund\n\nWorking draft for BKE Digital Solutions Staging. Not approved.")).toBe(true);
  });

  it("does not block normal reviewed or Staging test notices by accidental keyword matches", () => {
    expect(isUnapprovedLegalReviewDraft("Software License Agreement", "# Software License Agreement\n\nPublished approved content.")).toBe(false);
    expect(isUnapprovedLegalReviewDraft("Staging Test Terms", "# Staging Test Terms\n\nUse your Google account for testing.")).toBe(false);
    expect(isUnapprovedLegalReviewDraft("Refund Policy", "# Refund\n\nA customer may ask for policy review.")).toBe(false);
  });
});

describe("real-money legal agreement boundary", () => {
  const production = { DEPLOYMENT_ENV: "production", PAYMONGO_LIVEMODE: "true" };
  const mock = { DEPLOYMENT_ENV: "staging", PAYMONGO_LIVEMODE: "false" };
  const testDocuments = [
    ["Mock Checkout Test License Notice", "# License\nNo real money is charged. This is testing only."],
    ["Mock Checkout Test Payment and Refund Notice", "# Test refund policy\nApplies only to noncommercial BKE Digital Solutions checkout testing."],
    ["Mock Checkout Test Subscription Notice", "# Test subscriptions\nNot a commercial agreement."],
    ["Staging Test Terms", "# Staging Test Terms\nPayments are in mock mode."],
  ] as const;
  it.each(testDocuments)("blocks %s for real charges, not for mock-only testing", (title, markdown) => {
    expect(isCheckoutLegalNoticeAllowed(title, markdown, mock)).toBe(true);
    expect(isCheckoutLegalNoticeAllowed(title, markdown, production)).toBe(false);
  });
  it("permits genuinely finalized agreements in live mode", () => {
    expect(isCheckoutLegalNoticeAllowed("Software License Agreement",
      "# Software License Agreement\nCustomer rights, fees and support.",production)).toBe(true);
  });
  it("never enables unapproved REVIEW DRAFT in either mode", () => {
    expect(isCheckoutLegalNoticeAllowed("Software License Agreement - REVIEW DRAFT",
      "# Review",mock)).toBe(false);
    expect(isCheckoutLegalNoticeAllowed("Software License Agreement - REVIEW DRAFT",
      "# Review",production)).toBe(false);
  });
});
