import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("lib/customer-lifecycle.ts", "utf8");

describe("customer lifecycle owner-adoption parity", () => {
  it("keeps the Accounts retention blocker vocabulary locked for future owner adoption", () => {
    for (const blocker of [
      "ADMINISTRATOR_PROTECTED",
      "ORGANIZATION_OWNER_TRANSFER_REQUIRED",
      "ACTIVE_SUBSCRIPTION",
      "UNRESOLVED_PAYMENT_OR_REFUND",
      "LEGAL_HOLD",
      "RETENTION_PERIOD_ACTIVE",
      "IMMUTABLE_LEGAL_ACCEPTANCE",
      "PRESERVED_COMMERCIAL_HISTORY",
      "UNRELATED_ACCOUNT_MEMBERSHIP",
      "LICENSE_ASSIGNMENT_REMAINS",
    ]) {
      expect(source).toContain(`\"${blocker}\"`);
    }
  });

  it("keeps the Accounts lifecycle transition contract locked", () => {
    for (const code of [
      "FORBIDDEN",
      "CUSTOMER_CLOSURE_BLOCKED",
      "CUSTOMER_ALREADY_CLOSED",
      "PRIVACY_DELETION_BLOCKED",
      "LEGAL_HOLD_ACTIVE",
      "RETENTION_PERIOD_ACTIVE",
      "PURGE_NOT_ELIGIBLE",
      "PURGE_CONFIRMATION_REQUIRED",
    ]) {
      expect(source).toContain(`\"${code}\"`);
    }

    expect(source).toContain("ORGANIZATION_OWNER_TRANSFER_REQUIRED");
    expect(source).toContain("PRIVACY_REVIEW_REQUIRED");
    expect(source).toContain("MARK_PURGE_ELIGIBLE_FIRST");
    expect(source).toContain("RETENTION_DATE_MUST_BE_FUTURE");
    expect(source).toContain("Administrative legal hold");
  });

  it("keeps the Privacy 0.2 minimization intent locked", () => {
    expect(source).toContain("removed+${id}@privacy.invalid");
    expect(source).toContain("email.trim().toLowerCase()");
    expect(source).toContain("PRIVACY_MINIMIZATION");
    expect(source).toContain("Former customer");
    expect(source).toContain("CUSTOMER_PERSONAL_DATA_PSEUDONYMIZED");
    expect(source).toContain("preservedHistory: true");
    expect(source).toContain("emailHashRetained: true");
  });

  it("keeps host-only HOW visibly separate from the owner policy surface", () => {
    expect(source).toContain("createHmac(\"sha256\", env.SESSION_SECRET)");
    expect(source).toContain("Prisma.TransactionIsolationLevel.Serializable");
    expect(source).toContain("tx.session.deleteMany");
    expect(source).toContain("tx.passwordCredential.deleteMany");
    expect(source).toContain("tx.passwordResetToken.deleteMany");
    expect(source).toContain("tx.verificationToken.deleteMany");
  });
});
