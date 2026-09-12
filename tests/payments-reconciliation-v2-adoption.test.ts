import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("V2 Payments reconciliation host adoption", () => {
  it("routes RUN and ACKNOWLEDGE through the released Payments capability", () => {
    const route = read("app/api/admin/payments/reconcile/route.ts");
    expect(route).toContain("PAYMENTS_RECONCILIATION_CAPABILITY_ID");
    expect(route).toContain("getV2WebApplication");
    expect(route).toContain("reconciliation.run");
    expect(route).toContain("reconciliation.acknowledge");
    expect(route).toContain("PAYMENT_RECONCILIATION_RUN");
    expect(route).toContain("PAYMENT_RECONCILIATION_ACKNOWLEDGED");
    expect(route).not.toContain('from "@/lib/reconciliation"');
  });

  it("renders reconciliation evidence from the package-owned read capability", () => {
    const page = read("app/admin/payments/page.tsx");
    expect(page).toContain("PAYMENTS_RECONCILIATION_CAPABILITY_ID");
    expect(page).toContain("listRecent");
    expect(page).not.toContain("db.paymentReconciliation");
  });

  it("keeps reconciliation composed in the V2 Payments runtime", () => {
    const moduleSource = read("v2/modules/payments/module.ts");
    const runtime = read("v2/apps/web/runtime.ts");
    expect(moduleSource).toContain("createPaymentsReconciliationCapability");
    expect(moduleSource).toContain("createPostgresPaymentsReconciliationRepository");
    expect(runtime).toContain("reconciliationProvider: payments");
  });

  it("exposes reconciliation retrieval through the real web provider and standalone boot", () => {
    const provider = read("v2/apps/web/payments/provider.ts");
    const standalone = read("v2/apps/standalone/bootstrap.ts");
    expect(provider).toContain("PaymentsReconciliationProvider");
    expect(provider).toContain("async retrievePayment");
    expect(standalone).toContain("inertReconciliationProvider");
    expect(standalone).toContain("reconciliationProvider: inertReconciliationProvider");
  });

  it("moves operational reconciliation CLI usage onto the package capability", () => {
    const cli = read("scripts/reconcile-payments.ts");
    expect(cli).toContain("createPaymentsReconciliationCapability");
    expect(cli).toContain("createPostgresPaymentsReconciliationRepository");
    expect(cli).toContain("createPayMongoPaymentsAdapter");
    expect(cli).not.toContain("../lib/reconciliation");
  });

  it("routes webhook ingestion through the released Payments capability", () => {
    const webhook = read("lib/webhooks.ts");
    const ingestion = read("v2/apps/web/payments/webhook-ingestion.ts");
    const compatibilityProvider = read("v2/apps/web/payments/compatibility-provider.ts");
    expect(webhook).toContain('from "@/v2/apps/web/payments/webhook-ingestion"');
    expect(webhook).not.toContain('from "@/lib/payments"');
    expect(webhook).not.toContain('from "@/lib/payments/types"');
    expect(ingestion).toContain("createPaymentsProviderEventIngestionCapability");
    expect(ingestion).toContain("createPaymentEventVerifier");
    expect(ingestion).toContain("capability.ingest");
    expect(ingestion).not.toContain("createPayMongoPaymentsAdapter");
    expect(ingestion).not.toContain("resolvePayMongoConfiguration");
    expect(compatibilityProvider).toContain("createPaymentEventVerifier");
    expect(compatibilityProvider).toContain("createPayMongoPaymentsAdapter");
    expect(compatibilityProvider).toContain("mockEventVerifier");
  });

  it("removes obsolete legacy reconciliation calls from host integration and sandbox tests", () => {
    expect(read("tests/integration/lifecycle.test.ts")).not.toContain("@/lib/reconciliation");
    expect(read("tests/sandbox/paymongo.sandbox.test.ts")).not.toContain("@/lib/reconciliation");
  });

  it("retires the legacy reconciliation service", () => {
    expect(existsSync(resolve(root, "lib/reconciliation.ts"))).toBe(false);
  });
});
