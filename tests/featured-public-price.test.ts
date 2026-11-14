import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  selectFeaturedPublicPrice, type FeaturedPublicPlanQuote,
} from "@/apps/web/catalog/featured-public-price";

const plan = (
  overrides: Partial<FeaturedPublicPlanQuote> = {},
): FeaturedPublicPlanQuote => ({
  planId: "monthly-1",
  editionName: "Standard",
  planType: "MONTHLY",
  baseMinor: 49_900,
  promotion: null,
  ...overrides,
});

describe("homepage featured public promotion display", () => {
  it("uses the lowest canonical base quote and shows billing term without an offer", () => {
    expect(selectFeaturedPublicPrice([
      plan({ planId: "annual", planType: "ANNUAL", baseMinor: 480_000 }),
      plan(),
      plan({ planId: "semi", planType: "SEMI_ANNUAL", baseMinor: 265_000 }),
    ])).toEqual({
      priceLabel: "From ₱499.00/month",
      originalPriceLabel: null,
      discountLabel: null,
      planLabel: "Standard edition",
    });
  });

  it("shows an authorized discounted PHP price, struck original and exact same plan period", () => {
    expect(selectFeaturedPublicPrice([
      plan({
        planId: "annual-pro",
        editionName: "Professional",
        planType: "ANNUAL",
        baseMinor: 120_000,
        promotion: { finalMinor: 90_000, discountMinor: 30_000, discountBps: 2_500 },
      }),
    ])).toEqual({
      priceLabel: "Offer ₱900.00/year",
      originalPriceLabel: "₱1,200.00/year",
      discountLabel: "25% OFF",
      planLabel: "Professional edition",
    });
  });

  it("does not call a promotional term the 'From' price when a cheaper monthly term exists", () => {
    const selected = selectFeaturedPublicPrice([
      plan({ planId: "monthly", baseMinor: 10_000 }),
      plan({
        planId: "annual-offer", planType: "ANNUAL", baseMinor: 120_000,
        promotion: { finalMinor: 90_000, discountMinor: 30_000, discountBps: 2_500 },
      }),
    ]);
    expect(selected?.priceLabel).toBe("Offer ₱900.00/year");
    expect(selected?.priceLabel).not.toContain("From");
    expect(selected?.originalPriceLabel).toBe("₱1,200.00/year");
  });

  it("chooses the least expensive actual public offer and preserves six-month terms", () => {
    const selected = selectFeaturedPublicPrice([
      plan({
        planId: "annual", planType: "ANNUAL", baseMinor: 500_000,
        promotion: { finalMinor: 400_000, discountMinor: 100_000, discountBps: 2_000 },
      }),
      plan({
        planId: "semi", planType: "SEMI_ANNUAL", baseMinor: 300_000,
        promotion: { finalMinor: 240_000, discountMinor: 60_000, discountBps: 2_000 },
      }),
    ]);
    expect(selected).toMatchObject({
      priceLabel: "Offer ₱2,400.00/6 months",
      originalPriceLabel: "₱3,000.00/6 months",
      discountLabel: "20% OFF",
    });
  });

  it("does not market absent, private, coupon-only, expired or ineligible promotions", () => {
    // Public preview rejects nonpublic/not-applicable offers with no PRICED value;
    // those reach the landing selector as null, never as invented promotions.
    const absent = selectFeaturedPublicPrice([
      plan({ planType: "PERPETUAL", baseMinor: 349_900, promotion: null }),
    ]);
    expect(absent).toMatchObject({
      priceLabel: "From ₱3,499.00 one-time",
      originalPriceLabel: null,
      discountLabel: null,
    });
    expect(selectFeaturedPublicPrice([])).toBeNull();
  });

  it("cannot advertise inconsistent or zero-discount preview values", () => {
    const selected = selectFeaturedPublicPrice([
      plan({
        planId: "invalid-offer",
        promotion: { finalMinor: 49_900, discountMinor: 0, discountBps: 0 },
      }),
      plan({ planId: "legitimate", baseMinor: 39_900 }),
    ]);
    expect(selected).toMatchObject({
      priceLabel: "From ₱399.00/month",
      originalPriceLabel: null,
      discountLabel: null,
    });
  });

  it("wires the existing public Commerce capability, not a new price authority, into semantic markup", () => {
    const home = readFileSync("app/page.tsx", "utf8");
    const landing = readFileSync("app/landing-experience.tsx", "utf8");
    const css = readFileSync("app/landing-experience.module.css", "utf8");
    expect(home).toContain("COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID");
    expect(home).toContain("COMMERCE_PUBLIC_PROMOTION_PREVIEW_CAPABILITY_ID");
    expect(home).toContain("pricing.resolve(plan)");
    expect(home).toContain("promotions.preview({");
    expect(home).toContain('preview.status === "PRICED" ? preview.value : null');
    expect(home).toContain("selectFeaturedPublicPrice(quotes)");
    expect(home).not.toContain("applyOfferDiscount(");
    expect(landing).toContain("<del className={styles.originalPrice}>{product.originalPriceLabel}</del>");
    expect(landing).toContain("{product.priceLabel}");
    expect(landing).toContain("{product.planLabel}");
    expect(css).toContain("text-decoration: line-through");
  });
});
