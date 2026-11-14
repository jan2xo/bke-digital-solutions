import {
  COMMERCE_PUBLIC_PROMOTION_PREVIEW_CAPABILITY_ID,
  type CommercePublicPromotionPreviewCapability,
} from "@bke/commerce/contracts/public-promotion-preview.contract";
import {
  COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID,
  type CommercePurchasePlanPricingCapability,
} from "@bke/commerce/contracts/purchase-plan-pricing.contract";
import { LandingExperience } from "@/app/landing-experience";
import { selectFeaturedPublicPrice } from "@/apps/web/catalog/featured-public-price";
import { db } from "@/platform/host/db";
import { getSiteContent } from "@/apps/web/site-content";
import { getV2WebApplication } from "@/apps/web/runtime";
import { currentUser } from "@/apps/web/auth/session";
import { resolveProductImageUrl } from "@/apps/web/catalog/product-image";

export default async function Home() {
  const [content, products, application, user] = await Promise.all([
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
    currentUser(),
  ]);

  const pricing = application.get<CommercePurchasePlanPricingCapability>(
    COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID,
  );
  const promotions = application.get<CommercePublicPromotionPreviewCapability>(
    COMMERCE_PUBLIC_PROMOTION_PREVIEW_CAPABILITY_ID,
  );
  const cards = await Promise.all(products.map(async (product) => {
    const quotes = await Promise.all(product.editions.flatMap((edition) =>
      edition.purchasePlans.map(async (plan) => {
        const result = pricing.resolve(plan);
        if (result.status === "FAILED") throw new Error(result.code);
        const preview = await promotions.preview({
          productId: edition.productId,
          editionId: plan.editionId,
          purchasePlanId: plan.id,
          planType: plan.type,
          baseMinor: result.pricing.amountMinor,
        });
        if (preview.status === "FAILED") throw new Error(preview.code);
        const promotion = preview.status === "PRICED" ? preview.value : null;
        return {
          planId: plan.id,
          editionName: edition.name,
          planType: plan.type,
          baseMinor: result.pricing.amountMinor,
          promotion: promotion ? {
            finalMinor: promotion.finalMinor,
            discountMinor: promotion.discountMinor,
            discountBps: promotion.discountBps,
          } : null,
        };
      }),
    ));
    const selected = selectFeaturedPublicPrice(quotes);
    const fallback = product.prices[0]?.amountMinor;
    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      summary: product.summary,
      type: product.type,
      imageUrl: resolveProductImageUrl(product.imageKey),
      priceLabel: selected?.priceLabel ?? (fallback === undefined ? "Explore solution" : `From ${money(fallback)}`),
      originalPriceLabel: selected?.originalPriceLabel ?? null,
      discountLabel: selected?.discountLabel ?? null,
      planLabel: selected?.planLabel ?? null,
    };
  }));

  const account = user ? (user.role === "ADMIN" ? "ADMIN" : "CUSTOMER") : null;
  return <LandingExperience content={{
    heroEyebrow: content.heroEyebrow,
    heroDescription: content.heroDescription,
    siteName: content.siteName,
    solutionsEyebrow: content.solutionsEyebrow,
    solutionsHeading: content.solutionsHeading,
    solutionsAccent: content.solutionsAccent,
    solutionsLinkLabel: content.solutionsLinkLabel,
  }} products={cards} account={account} />;
}

function money(minor: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(minor / 100);
}
