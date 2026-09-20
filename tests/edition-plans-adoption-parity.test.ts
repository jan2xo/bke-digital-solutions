import { describe, expect, it, vi } from "vitest";
import { CommerceEditionPlanValidationError } from "@bke/commerce/logic/edition-plan-management";
import {
  createEditionPlanRepository,
  editionPlanValidationMessage,
  normalizeEditionPlanForHost,
  synchronizeEditionPlansWithCommerce,
} from "@/apps/web/commerce/edition-plan-management";

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

describe("edition plan owner adoption parity", () => {
  it("maps owner validation reasons to the legacy admin presentation", () => {
    expect(editionPlanValidationMessage("PURCHASE_PLAN_REQUIRED")).toBe("At least one purchase plan is required");
    expect(editionPlanValidationMessage("ANNUAL_REQUIRES_MONTHLY")).toBe("Annual requires an enabled monthly plan");
    expect(editionPlanValidationMessage("ANNUAL_DISCOUNT_REQUIRED")).toBe("Annual discount is required");
    expect(editionPlanValidationMessage("PERPETUAL_PRICE_REQUIRED")).toBe("Perpetual price is required");
    expect(editionPlanValidationMessage("MONTHLY_PRICE_REQUIRED")).toBe("Monthly price is required");
  });

  it("preserves Commerce-owned defaults and trimmed blank descriptions", () => {
    const normalized = normalizeEditionPlanForHost({
      ...baseEdition,
      description: "   ",
      features: undefined,
      active: undefined,
      plans: {
        perpetual: { enabled: true, amountMinor: 100 },
        monthly: { enabled: false },
        annual: { enabled: false },
      },
    });
    expect(normalized.description).toBe("");
    expect(normalized.features).toEqual([]);
    expect(normalized.active).toBe(true);
  });

  it("presents typed Commerce validation errors instead of raw domain codes", () => {
    expect(() => normalizeEditionPlanForHost({
      ...baseEdition,
      plans: {
        perpetual: { enabled: false },
        monthly: { enabled: false },
        annual: { enabled: false },
      },
    })).toThrow("At least one purchase plan is required");
    const typed = new CommerceEditionPlanValidationError("PURCHASE_PLAN_REQUIRED");
    expect(typed.message).toBe("INVALID_EDITION_PLAN:PURCHASE_PLAN_REQUIRED");
  });

  it("preserves exact Prisma three-plan synchronization writes", async () => {
    const upsert = vi.fn()
      .mockResolvedValueOnce({ id: "perpetual-plan" })
      .mockResolvedValueOnce({ id: "monthly-plan" })
      .mockResolvedValueOnce({ id: "annual-plan" });
    const tx = { purchasePlan: { upsert } } as never;

    await synchronizeEditionPlansWithCommerce(tx, "edition-1", {
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

  it("uses create fallback 100 while omitting disabled-plan amount updates", async () => {
    const upsert = vi.fn()
      .mockResolvedValueOnce({ id: "perpetual-plan" })
      .mockResolvedValueOnce({ id: "monthly-plan" })
      .mockResolvedValueOnce({ id: "annual-plan" });
    const tx = { purchasePlan: { upsert } } as never;

    await synchronizeEditionPlansWithCommerce(tx, "edition-1", {
      perpetual: { enabled: false },
      monthly: { enabled: true, amountMinor: 200 },
      annual: { enabled: false },
    });

    expect(upsert.mock.calls[0]![0].create.amountMinor).toBe(100);
    expect(upsert.mock.calls[0]![0].update).not.toHaveProperty("amountMinor");
  });

  it("keeps the Prisma repository adapter as host-owned HOW", () => {
    const tx = { edition: { create: vi.fn() }, purchasePlan: { upsert: vi.fn() } } as never;
    expect(createEditionPlanRepository(tx)).toEqual(expect.objectContaining({
      createEdition: expect.any(Function),
      upsertPurchasePlan: expect.any(Function),
    }));
  });
});
