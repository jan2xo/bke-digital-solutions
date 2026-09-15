import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Final owner-adoption parity runs against released Commerce 0.11.0 and Payments 0.6.0.
// Transaction adapters are explicitly typed against the released owner repository ports.
const processorSource = readFileSync("apps/web/payments/webhook-processing.ts", "utf8");
const ingestionSource = readFileSync("apps/web/payments/webhook-ingestion.ts", "utf8");
const settlementSource = readFileSync("apps/web/payments/settlement-transaction.ts", "utf8");
const licensingSource = readFileSync("apps/web/licensing/entitlement-management.ts", "utf8");
const publicRouteSource = readFileSync("app/api/webhooks/payments/route.ts", "utf8");
const adminRouteSource = readFileSync("app/api/admin/payments/webhooks/[id]/route.ts", "utf8");
const schedulerSource = readFileSync("apps/web/scheduler/handlers.ts", "utf8");
const payMongoSource = readFileSync(
  "node_modules/@bke/payments/providers/paymongo/paymongo-adapter.ts",
  "utf8",
);

describe("payment webhook owner-adoption parity", () => {
  it("locks provider normalization and owner-ingestion replay semantics", () => {
    expect(payMongoSource).toContain('rawType === "payment.refunded"');
    expect(payMongoSource).toContain('? "payment.refunded"');
    expect(ingestionSource).toContain("createPaymentsProviderEventIngestionCapability");
    expect(ingestionSource).toContain('skipDuplicates: true');
    expect(ingestionSource).toContain('PAYMENT_EVENT_REPLAY_CONFLICT');
    expect(ingestionSource).toContain('result.disposition === "EXISTING"');
    expect(ingestionSource).toContain('processingAttempts: { increment: 1 }');
    expect(ingestionSource).toContain('INSERT INTO "PaymentProviderEvent"');
  });

  it("locks one transaction-bound Payments → Commerce → Entitlements settlement graph", () => {
    expect(settlementSource).toContain("createPaymentsSettlementFactCapability");
    expect(settlementSource).toContain("createCommerceSettlementReactionCapability");
    expect(settlementSource).toContain("createEntitlementsDurableRightGrantCapability");
    expect(settlementSource).toContain('FROM "PaymentProviderEvent"');
    expect(settlementSource).toContain('FROM "PaymentCheckoutAttempt"');
    expect(settlementSource).toContain('INSERT INTO "PaymentSettlementFact"');
    expect(settlementSource).toContain('INSERT INTO "Entitlement"');
  });

  it("locks Commerce late-settlement owner semantics including released reservations", () => {
    expect(settlementSource).toContain('order.status === "CANCELLED"');
    expect(settlementSource).toContain('redemption?.status === "RELEASED"');
    expect(settlementSource).toContain('AFTER_LOCAL_CANCELLATION');
    expect(processorSource).toContain('PAYMENT_SETTLED_AFTER_LOCAL_CANCELLATION');
  });

  it("locks Licensing entitlement management behind the same host transaction boundary", () => {
    expect(licensingSource).toContain("createLicensingEntitlementManagementCapability");
    expect(licensingSource).toContain("licensingInitialExpiration");
    expect(licensingSource).toContain("licensingRenewalExpiration");
    expect(licensingSource).toContain("generateLicenseKey");
    expect(licensingSource).toContain("encryptLicenseKey");
    expect(licensingSource).not.toContain('@/lib/licensing');
    expect(licensingSource).not.toContain('@/lib/time');
  });

  it("locks host-owned orchestration around owner decisions", () => {
    expect(processorSource).toContain('process.env.PAYMONGO_LIVEMODE === "true"');
    expect(processorSource).toContain('event.type === "payment.paid"');
    expect(processorSource).toContain('event.type === "payment.failed"');
    expect(processorSource).toContain('event.type === "payment.refund.updated"');
    expect(processorSource).toContain('event.type === "unknown"');
    expect(processorSource).toContain('PAYMENT_EVENT_UNSUPPORTED');
    expect(processorSource).toContain('db.$transaction');
    expect(processorSource).toContain('isolationLevel: "Serializable"');
    expect(processorSource).toContain('fulfillOrderLicensing');
    expect(processorSource).toContain('issueCommercialLease');
    expect(processorSource).toContain('dispatchEmailOutbox');
  });

  it("locks all production callers onto the V2 processor and retires lib/webhooks.ts", () => {
    const ownerPath = '@/apps/web/payments/webhook-processing';
    expect(publicRouteSource).toContain(ownerPath);
    expect(adminRouteSource).toContain(ownerPath);
    expect(schedulerSource).toContain(ownerPath);
    expect(publicRouteSource).not.toContain('@/lib/webhooks');
    expect(adminRouteSource).not.toContain('@/lib/webhooks');
    expect(schedulerSource).not.toContain('@/lib/webhooks');
    expect(existsSync("lib/webhooks.ts")).toBe(false);
  });
});
