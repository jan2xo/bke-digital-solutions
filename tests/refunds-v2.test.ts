import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("V2 admin refund adoption", () => {
  const route = readFileSync("app/api/admin/payments/refunds/route.ts", "utf8");

  it("routes full refunds through the released Payments capability", () => {
    expect(route).toContain("PAYMENTS_REFUND_INITIATION_CAPABILITY_ID");
    expect(route).toContain("initiateFullByCommercialReference");
    expect(route).toContain("commercialReference:input.orderId");
    expect(route).toContain("sourceReference:`admin-full-refund:${input.orderId}`");
    expect(route).not.toContain('from "@/lib/refunds"');
  });

  it("retains host admin confirmation and audit responsibilities", () => {
    expect(route).toContain("REFUND_CONFIRMATION_REQUIRED");
    expect(route).toContain("PAYMENT_REFUND_REQUESTED");
    expect(route).toContain('from "@/v2/apps/web/audit"');
  });
});
