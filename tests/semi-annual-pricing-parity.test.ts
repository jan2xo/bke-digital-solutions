import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createCommercePurchasePlanPricingCapability } from "@bke/commerce/logic/purchase-plan-pricing";
import {
  editionPlanInputSchema,
  normalizeEditionPlanForHost,
  synchronizeEditionPlansWithCommerce,
} from "@/apps/web/commerce/edition-plan-management";

const pricing = createCommercePurchasePlanPricingCapability();
const monthly = (amountMinor: number) => ({
  active: true, type: "MONTHLY" as const, amountMinor,
  editionId: "edition-1", currency: "PHP",
});
const plan = (amountMinor: number, discountBps = 0) => ({
  id: "semi-1", editionId: "edition-1", type: "SEMI_ANNUAL" as const,
  currency: "PHP", amountMinor: null, annualDiscountBps: null,
  semiAnnualDiscountBps: discountBps,
  renewalBehavior: "CUSTOMER_AUTHORIZED" as const,
  monthlySource: monthly(amountMinor),
});

describe("restored semi-annual pricing authority", () => {
  it("derives six months from monthly, independently of yearly pricing and preserves half-up rounding", () => {
    const original = pricing.resolve(plan(1_001, 500));
    expect(original.status).toBe("RESOLVED");
    if (original.status !== "RESOLVED") throw new Error("SIX_MONTH_PRICE_FAILED");
    expect(original.pricing).toMatchObject({
      amountMinor: 5_706, monthlyAmountMinor: 1_001,
      intervalUnit: "MONTH", intervalCount: 6,
      savingsMinor: 300, discountBps: 500,
    });
    const repriced = pricing.resolve(plan(2_001, 500));
    expect(repriced.status).toBe("RESOLVED");
    if (repriced.status !== "RESOLVED") throw new Error("SIX_MONTH_REPRICE_FAILED");
    expect(repriced.pricing.amountMinor).toBe(11_406);
    // Catalog changes produce new quotes, not mutations of historical snapshots.
    const historicalInvoiceLineMinor = original.pricing.amountMinor;
    expect(historicalInvoiceLineMinor).toBe(5_706);
    expect(repriced.pricing.amountMinor).not.toBe(historicalInvoiceLineMinor);
    const noDiscount = pricing.resolve(plan(1_001, 0));
    expect(noDiscount.status).toBe("RESOLVED");
    if (noDiscount.status === "RESOLVED") expect(noDiscount.pricing.amountMinor).toBe(6_006);
  });

  it("allows 0–10% but rejects invalid, disabled, foreign edition and currency-mismatched source", () => {
    expect(pricing.resolve(plan(100, -1))).toEqual({ status: "FAILED", code: "INVALID_SEMI_ANNUAL_DISCOUNT" });
    expect(pricing.resolve(plan(100, 1_001))).toEqual({ status: "FAILED", code: "INVALID_SEMI_ANNUAL_DISCOUNT" });
    expect(pricing.resolve({ ...plan(100), monthlySource: { ...monthly(100), active: false } }))
      .toEqual({ status: "FAILED", code: "SEMI_ANNUAL_MONTHLY_PLAN_REQUIRED" });
    expect(pricing.resolve({ ...plan(100), monthlySource: { ...monthly(100), editionId: "wrong" } }))
      .toEqual({ status: "FAILED", code: "SEMI_ANNUAL_MONTHLY_PLAN_REQUIRED" });
    expect(pricing.resolve({ ...plan(100), monthlySource: { ...monthly(100), currency: "USD" } }))
      .toEqual({ status: "FAILED", code: "SEMI_ANNUAL_MONTHLY_PLAN_REQUIRED" });
  });

  it("validates Admin Products discount as an independent policy, never an absolute six-month price", async () => {
    const plans = {
      perpetual: { enabled: false, amountMinor: 100_000 },
      monthly: { enabled: true, amountMinor: 49_900 },
      semiAnnual: { enabled: true, discountBps: 0 },
      annual: { enabled: true, discountBps: 500 },
    };
    const body = {
      name: "Professional", slug: "pro", maxUsers: 1, maxDevicesPerUser: 1,
      updatePolicy: "ACTIVE_TERM" as const, plans,
    };
    expect(editionPlanInputSchema.parse(body).plans.semiAnnual).toEqual(plans.semiAnnual);
    expect(normalizeEditionPlanForHost(body).plans.semiAnnual).toEqual(plans.semiAnnual);
    expect(() => editionPlanInputSchema.parse({ ...body,
      plans: { ...plans, semiAnnual: { ...plans.semiAnnual, amountMinor: 1 } },
    })).toThrow();
    const upsert = vi.fn(async (input: { type: string }) => ({ id: input.type === "MONTHLY" ? "monthly-id" : input.type }));
    await synchronizeEditionPlansWithCommerce({
      purchasePlan: { upsert },
    } as never, "edition-1", plans);
    expect(upsert).toHaveBeenCalledTimes(4);
    const semi = upsert.mock.calls.map(call => call[0]).find(call => call.where.editionId_type.type === "SEMI_ANNUAL");
    expect(semi?.create).toMatchObject({
      amountMinor: null, semiAnnualDiscountBps: 0,
      monthlySourcePlanId: "monthly-id", active: true,
    });
  });

  it("uses canonical plan and calendar billing across public, Agent, customer and renewal paths", () => {
    const publicCatalog = readFileSync("app/products/[slug]/page.tsx", "utf8");
    const agentCatalog = readFileSync("apps/web/catalog/agent-store-catalog.ts", "utf8");
    const checkout = readFileSync("app/api/checkout/route.ts", "utf8");
    const agentCheckout = readFileSync("app/api/agent-sessions/store/checkout-start/route.ts", "utf8");
    const renewal = readFileSync("app/api/subscriptions/[id]/renew/route.ts", "utf8");
    const legalReview = readFileSync("app/api/agent-sessions/store/checkout-review/route.ts", "utf8");
    const host = readFileSync("components/admin-edition-editor.tsx", "utf8");
    for (const path of [publicCatalog, agentCatalog, checkout, agentCheckout, renewal, legalReview, host]) {
      expect(path).toContain("SEMI_ANNUAL");
    }
    expect(publicCatalog).toContain("pricing.resolve(plan)");
    expect(agentCatalog).toContain("pricing.resolve(plan)");
    for (const code of [checkout, agentCheckout, renewal]) {
      expect(code).toContain("grossSemiAnnualAmountMinor");
      expect(code).toContain("semiAnnualDiscountBps");
      expect(code).toContain("intervalCount: pricing.intervalCount");
      expect(code).not.toContain("pricing.amountMinor * 6");
    }
    expect(legalReview).toContain('plan.type === "SEMI_ANNUAL" ? "MONTHLY" : plan.type');
    expect(renewal).toContain("renewalSubscriptionId");
    expect(host).toContain("semiAnnualEnabled");
    expect(host).not.toContain('name="semiAnnualPrice"');
  });

  it("uses additive migrations without changing existing settled order or invoice amounts", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const e = readFileSync("prisma/migrations/20261110120000_semi_annual_plan_type/migration.sql", "utf8");
    const t = readFileSync("prisma/migrations/20261110120100_semi_annual_plan_policy/migration.sql", "utf8");
    expect(schema).toContain("SEMI_ANNUAL");
    expect(schema).toContain("semiAnnualDiscountBps");
    expect(e).toContain("ADD VALUE IF NOT EXISTS 'SEMI_ANNUAL'");
    expect(t).toContain('ADD COLUMN "semiAnnualDiscountBps"');
    expect(t).toContain("BETWEEN 0 AND 1000");
    expect(e + t).not.toMatch(/UPDATE\s+"(?:Order|Invoice|OrderItem|Payment)"/i);
  });
});
