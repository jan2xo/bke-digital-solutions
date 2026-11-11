import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const service = readFileSync("apps/web/trials/service.ts", "utf8");
const rights = readFileSync("apps/web/entitlements/trial-durable-right.ts", "utf8");
const lifecycle = readFileSync("tests/integration/trials.test.ts", "utf8");
const grantSource = service.slice(service.indexOf("export async function grantProductTrial"), service.indexOf("export async function changeTrial"));
const changeSource = service.slice(service.indexOf("export async function changeTrial"));

describe("Trial-to-durable Entitlements source parity", () => {
  it("issues durable rights via released Entitlements inside the trial's own transaction", () => {
    expect(rights).toContain("createEntitlementsDurableRightGrantCapability");
    expect(rights).toContain("EntitlementsDurableRightGrantRepository");
    expect(rights).toContain("trialGrantRepository(tx)");
    expect(rights).toContain('INSERT INTO "Entitlement"');
    expect(rights).toContain('ON CONFLICT ("sourceReference") DO NOTHING');
    expect(rights).not.toContain("createPostgresEntitlementsDurableRightGrantRepository");
    expect(rights).not.toContain("new Client(");
    expect(rights).not.toContain("new PrismaClient(");
    expect(grantSource).toContain("grantTrialDurableRight(tx,");
    expect(grantSource.indexOf("await grantTrialDurableRight(tx,")).toBeGreaterThan(
      grantSource.indexOf("await tx.trialGrant.create({"),
    );
    expect(grantSource.indexOf("await grantTrialDurableRight(tx,")).toBeLessThan(
      grantSource.indexOf("await tx.auditLog.create({"),
    );
    expect(grantSource).toContain('isolationLevel: "Serializable"');
  });

  it("binds exactly one right to the same zero-cost paid trial order, edition and customer", () => {
    expect(rights).toContain("trialOrderEntitlementSource(input.orderId, input.orderItemId)");
    expect(rights).toContain("sourceReference: trialOrderEntitlementSource(");
    expect(rights).toContain("subjectId: input.accountId");
    expect(rights).toContain("resourceId: input.editionId");
    expect(rights).toContain("quantity: 1");
    expect(rights).toContain('source: "TRIAL"');
    expect(rights).toContain("trialId: input.trialId");
    expect(rights).toContain("licenseId: input.licenseId");
    expect(grantSource).toContain("orderId: order.id");
    expect(grantSource).toContain("orderItemId: order.items[0]!.id");
    expect(grantSource).toContain("licenseId: license.id");
    expect(grantSource).toContain("trialId: trial.id");
    expect(grantSource).toContain('if (account.lifecycleState !== "ACTIVE")');
    expect(rights).toContain('if (right.status !== "GRANTED")');
  });

  it("hard-stops the durable right at trialEndsAt rather than the optional grace period", () => {
    expect(grantSource).toContain("endsAt: plan.trialEndsAt");
    expect(rights).toContain("validUntil: input.endsAt");
    expect(rights).not.toContain("graceEndsAt");
    expect(lifecycle).toContain("right.validUntil).toEqual(trial.trialEndsAt)");
    expect(lifecycle).toContain("rights[0]?.validUntil).toEqual(trial.trialEndsAt)");
  });

  it("revokes the durable grant atomically with the license and existing devices", () => {
    expect(changeSource).toContain("revokeTrialDurableRight(tx,");
    expect(changeSource).toContain("deactivateDevices");
    expect(changeSource).toContain("await tx.license.update(");
    expect(changeSource).toContain('isolationLevel: "Serializable"');
    expect(rights).toContain("revokeOrderEntitlements(tx, input.orderId");
    expect(rights).toContain('reason: "TRIAL_REVOKED"');
    expect(rights).toContain('if (row.status === "REVOKED")');
    expect(rights).toContain('if (!row) return "legacy_absent"');
    expect(rights).toContain("TRIAL_ENTITLEMENT_REVOCATION_INCONSISTENT");
    expect(lifecycle).toContain('rightAfterRevocation.status).toBe("REVOKED")');
    expect(lifecycle).toContain('revocationReference).toBe(');
  });

  it("does not change the legacy key-lease API, provider calls, signing authority or product gates", () => {
    expect(service).not.toContain("issueAccountProductLeaseJws");
    expect(rights).not.toContain("createPrivateKey");
    expect(rights).not.toContain("PayMongo");
    expect(rights).not.toContain("Resend");
    expect(service).not.toContain("V3_");
    expect(rights).not.toContain("V3_");
  });
});
