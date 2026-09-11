import {
  COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID,
  type CommercePurchasePlanPricingCapability,
} from "@bke/commerce/contracts/purchase-plan-pricing.contract";
import { LandingExperience } from "@/app/landing-experience";
import { db } from "@/v2/platform/host/db";
import { getSiteContent } from "@/v2/apps/web/site-content";
import { getV2WebApplication } from "@/v2/apps/web/runtime";

export default async function Home() {
  const [content, products, application] = await Promise.all([
    getSiteContent(),
    db.product.findMany({
      where: { active: true, archivedAt: null },
      include: {
        prices: { where: { active: true }, orderBy: { amountMinor: "asc" }, take: 1 },
        editions: {
          where: { active: true },
          include: { purchasePlans: { where: { active: true }, include: { monthlySource: true } } },
        },
      },
      orderBy: [{ featured: "desc" }, { publishedAt: "desc" }, { createdAt: "desc" }],
      take: 3,
    }),
    getV2WebApplication(),
  ]);

  const pricing = application.get<CommercePurchasePlanPricingCapability>(
    COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID,
  );
  const cards = products.map((product) => {
    const plans = product.editions.flatMap((edition) => edition.purchasePlans);
    const starting =
      plans
        .map((plan) => {
          const result = pricing.resolve(plan);
          if (result.status === "FAILED") throw new Error(result.code);
          return result.pricing.amountMinor;
        })
        .sort((a, b) => a - b)[0] ?? product.prices[0]?.amountMinor;
    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      summary: product.summary,
      type: product.type,
      priceLabel: starting === undefined ? "Explore solution" : `From ${money(starting)}`,
    };
  });

  const authoritativeHomepageContent = {
    ...content,
    siteName: content.siteName,
    heroHeadline: content.heroHeadline,
    heroPrimaryHref: content.heroPrimaryHref,
  };

  return <LandingExperience content={authoritativeHomepageContent} products={cards} />;
}

function money(minor: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(minor / 100);
}
