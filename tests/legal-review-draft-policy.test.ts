import { describe, expect, it } from "vitest";
import { isUnapprovedLegalReviewDraft } from "../apps/web/legal/review-draft-policy";

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
