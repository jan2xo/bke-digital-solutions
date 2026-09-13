import { describe, expect, it, vi } from "vitest";
import { editionPlanSchema, syncEditionPlans } from "@/lib/edition-plans";

const baseEdition = {
  name: "Professional",
  slug: "professional",
  description: "Professional edition",
  features: ["feature-a"],
  maxUsers: 10,
  maxDevicesPerUser: 3,
  updatePolicy: "ACTIVE_TERM" as const,
  active: true,
};

describe("edition plan adoption parity", () => {
  it("preserves the legacy purchase-plan validation invariants", () => {
    expect(() => editionPlanSchema.parse({
      ...baseEdition,
      plans: {
        perpetual: { enabled: false },
        monthly: { enabled: false },
        annual: { enabled: false },
      },
    })).toThrow("At least one purchase plan is required");

    expect(() => editionPlanSchema.parse({
      ...baseEdition,
      plans: {
        perpetual: { enabled: true, amountMinor: 1000 },
        monthly: { enabled: false },
        annual: { enabled: true, discountBps: 500 },
      },
    })).toThrow("Annual requires an enabled monthly plan");

    expect(() => editionPlanSchema.parse({
      ...baseEdition,
      plans: {
        perpetual: { enabled: false },
        monthly: { enabled: true, amountMinor: 1000 },
        annual: { enabled: true },
      },
    })).toThrow("Annual discount is required");

    expect(() => editionPlanSchema.parse({
      ...baseEdition,
      plans: {
        perpetual: { enabled: true },
        monthly: { enabled: false },
        annual: { enabled: false },
      },
    })).toThrow("Perpetual price is required");
  });

  it("preserves the three-plan synchronization contract", async () => {
    const upsert = vi.fn()
      .mockResolvedValueOnce({ id: "perpetual-plan" })
      .mockResolvedValueOnce({ id: "monthly-plan" })
      .mockResolvedValueOnce({ id: "annual-plan" });
    const tx = { purchasePlan: { upsert } } as never;

    await syncEditionPlans(tx, "edition-1", {
      perpetual: { enabled: true, amountMinor: 5000 },
      monthly: { enabled: true, amountMinor: 1000 },
      annual: { enabled: true, discountBps: 500 },
    });

    expect(upsert).toHaveBeenCalledTimes(3);
    expect(upsert.mock.calls[0]![0]).toMatchObject({
      where: { editionId_type: { editionId: "edition-1", type: "PERPETUAL" } },
      create: { editionId: "edition-1", type: "PERPETUAL", amountMinor: 5000, renewalBehavior: "NONE", active: true },
      update: { amountMinor: 5000, annualDiscountBps: null, monthlySourcePlanId: null, renewalBehavior: "NONE", active: true },
    });
    expect(upsert.mock.calls[1]![0]).toMatchObject({
      where: { editionId_type: { editionId: "edition-1", type: "MONTHLY" } },
      create: { editionId: "edition-1", type: "MONTHLY", amountMinor: 1000, renewalBehavior: "CUSTOMER_AUTHORIZED", active: true },
      update: { amountMinor: 1000, annualDiscountBps: null, monthlySourcePlanId: null, renewalBehavior: "CUSTOMER_AUTHORIZED", active: true },
    });
    expect(upsert.mock.calls[2]![0]).toMatchObject({
      where: { editionId_type: { editionId: "edition-1", type: "ANNUAL" } },
      create: { editionId: "edition-1", type: "ANNUAL", amountMinor: null, annualDiscountBps: 500, monthlySourcePlanId: "monthly-plan", renewalBehavior: "CUSTOMER_AUTHORIZED", active: true },
      update: { amountMinor: null, annualDiscountBps: 500, monthlySourcePlanId: "monthly-plan", renewalBehavior: "CUSTOMER_AUTHORIZED", active: true },
    });
  });
});
