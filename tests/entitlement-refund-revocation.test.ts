import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const adapterSource = readFileSync("apps/web/entitlements/refund-revocation.ts", "utf8");
const processorSource = readFileSync("apps/web/payments/webhook-processing.ts", "utf8");
const migrationSource = readFileSync(
  "prisma/migrations/20260923145000_v3_entitlement_refund_revocation/migration.sql",
  "utf8",
);

describe("durable Entitlement refund revocation", () => {
  it("routes confirmed SELF refunds through the reusable Entitlements revocation capability", () => {
    expect(adapterSource).toContain("createEntitlementsDurableRightRevocationCapability");
    expect(adapterSource).toContain('JOIN "OrderItem" item');
    expect(adapterSource).toContain("'commerce:' ||");
    expect(adapterSource).toContain('AND "status" = \'ACTIVE\'');
    expect(adapterSource).toContain('"revocationReference"');
    expect(adapterSource).toContain('"revocationSnapshot"');
    expect(processorSource).toContain("revokeOrderEntitlements");
    expect(processorSource).toContain('SELECT "fulfillmentMode"::text AS "fulfillmentMode"');
    expect(processorSource).toContain('refundFulfillmentMode === "ACCOUNT_ENTITLEMENT"');
    expect(processorSource).toContain('reason: "REFUND_CONFIRMED"');
  });

  it("persists terminal revocation shape without inventing suspension semantics", () => {
    expect(migrationSource).toContain("ADD VALUE IF NOT EXISTS 'REVOKED'");
    expect(migrationSource).toContain('"Entitlement_revocation_shape_check"');
    expect(migrationSource).toContain('"status" = \'ACTIVE\'');
    expect(migrationSource).toContain('"status" = \'REVOKED\'');
    expect(migrationSource).not.toContain("SUSPENDED");
    expect(migrationSource).not.toContain("EXPIRED");
  });
});
