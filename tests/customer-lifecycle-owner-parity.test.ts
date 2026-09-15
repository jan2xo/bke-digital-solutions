import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("apps/web/accounts/customer-lifecycle-operations.ts", "utf8");
const accountsModule = readFileSync("modules/accounts/module.ts", "utf8");

describe("customer lifecycle owner-adoption parity", () => {
  it("resolves Accounts retention and transition policies through the composed application", () => {
    expect(source).toContain("ACCOUNTS_CUSTOMER_RETENTION_POLICY_CAPABILITY_ID");
    expect(source).toContain("ACCOUNTS_CUSTOMER_LIFECYCLE_TRANSITION_POLICY_CAPABILITY_ID");
    expect(source).toContain("retentionPolicy.evaluate(");
    expect(source).toContain("lifecyclePolicy.close(");
    expect(source).toContain("lifecyclePolicy.reopen(");
    expect(source).toContain("lifecyclePolicy.requestPrivacyDeletion(");
    expect(source).toContain("lifecyclePolicy.legalHold(");
    expect(source).toContain("lifecyclePolicy.pseudonymize(");
    expect(source).toContain("lifecyclePolicy.markPurgeEligible(");
    expect(source).toContain("lifecyclePolicy.finalPurge(");
  });

  it("registers both released Accounts customer lifecycle policy capabilities", () => {
    expect(accountsModule).toContain("createAccountsCustomerRetentionPolicyCapability()");
    expect(accountsModule).toContain("createAccountsCustomerLifecycleTransitionPolicyCapability()");
    expect(accountsModule).toContain("id: ACCOUNTS_CUSTOMER_RETENTION_POLICY_CAPABILITY_ID");
    expect(accountsModule).toContain("id: ACCOUNTS_CUSTOMER_LIFECYCLE_TRANSITION_POLICY_CAPABILITY_ID");
  });

  it("delegates Privacy minimization intent to the released planner", () => {
    expect(source).toContain("planPrivacyCustomerMinimization({");
    expect(source).toContain("plan.normalizedEmailHashSource");
    expect(source).toContain("plan.emailOutboxUpdate");
    expect(source).toContain("plan.userUpdate");
    expect(source).toContain("plan.customerAccountUpdate");
    expect(source).toContain("plan.audit");
    expect(source).not.toContain("removed+${id}@privacy.invalid");
    expect(source).not.toContain('reason: "PRIVACY_MINIMIZATION"');
    expect(source).not.toContain('displayName: "Former customer"');
  });

  it("keeps host-only HOW visible without rebuilding owner policy", () => {
    expect(source).toContain('createHmac("sha256", env.SESSION_SECRET)');
    expect(source).toContain("Prisma.TransactionIsolationLevel.Serializable");
    expect(source).toContain("tx.session.deleteMany");
    expect(source).toContain("tx.passwordCredential.deleteMany");
    expect(source).toContain("tx.passwordResetToken.deleteMany");
    expect(source).toContain("tx.verificationToken.deleteMany");
    expect(source).not.toContain('blockers.push("ADMINISTRATOR_PROTECTED")');
    expect(source).not.toContain('blockers.push("ACTIVE_SUBSCRIPTION")');
    expect(source).not.toContain('blockers.push("LEGAL_HOLD")');
    expect(source).not.toContain('"Administrative legal hold"');
  });
});
