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

  it("retires the legacy reconciliation service", () => {
    expect(existsSync(resolve(root, "lib/reconciliation.ts"))).toBe(false);
  });
});
