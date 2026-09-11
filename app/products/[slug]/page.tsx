import {
  COMMERCE_PUBLIC_PROMOTION_PREVIEW_CAPABILITY_ID,
  type CommercePublicPromotionPreviewCapability,
} from "@bke/commerce/contracts/public-promotion-preview.contract";
import {
  COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID,
  type CommercePurchasePlanPricingCapability,
} from "@bke/commerce/contracts/purchase-plan-pricing.contract";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { PurchasePlanSelector } from "@/components/purchase-plan-selector";
import { TrialStartButton } from "@/components/trial-start-button";
import { listPurchaseAuthorizedAccounts } from "@/v2/apps/web/accounts/purchase-account-list";
import { currentIdentitySession } from "@/v2/apps/web/auth/session";
import { getV2WebApplication } from "@/v2/apps/web/runtime";

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [session, product, application] = await Promise.all([
    currentIdentitySession(),
    db.product.findUnique({
      where: { slug },
      include: {
        editions: {
          where: { active: true },
          include: { purchasePlans: { where: { active: true }, include: { monthlySource: true } } },
          orderBy: { sortOrder: "asc" },
        },
      },
    }),
    getV2WebApplication(),
  ]);
  if (!product?.active) notFound();

  const pricing = application.get<CommercePurchasePlanPricingCapability>(
    COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID,
  );
  const promotions = application.get<CommercePublicPromotionPreviewCapability>(
    COMMERCE_PUBLIC_PROMOTION_PREVIEW_CAPABILITY_ID,
  );
  const accounts = session ? await listPurchaseAuthorizedAccounts(session.principal.id) : [];

  return <section className="shell py-16 motion-fade-up">
    <p className="font-bold text-[#ffd15a]">{product.type}</p>
    <h1 className="mt-2 text-5xl font-black">{product.name}</h1>
    <p className="mt-6 max-w-3xl text-lg leading-8 text-[#a8b5c4]">{product.description}</p>
    <div className="mt-12 grid gap-8 motion-stagger">{await Promise.all(product.editions.map(async (edition) => {
      const plans = await Promise.all(edition.purchasePlans
        .sort((a, b) => ["PERPETUAL", "MONTHLY", "ANNUAL"].indexOf(a.type) - ["PERPETUAL", "MONTHLY", "ANNUAL"].indexOf(b.type))
        .map(async (plan) => {
          const pricingResult = pricing.resolve(plan);
          if (pricingResult.status === "FAILED") throw new Error(pricingResult.code);
          const terms = pricingResult.pricing;
          const promotionResult = await promotions.preview({
            productId: edition.productId,
            editionId: plan.editionId,
            purchasePlanId: plan.id,
            planType: plan.type,
            baseMinor: terms.amountMinor,
          });
          if (promotionResult.status === "FAILED") throw new Error(promotionResult.code);
          const promotion = promotionResult.status === "PRICED" ? promotionResult.value : null;
          const annual = plan.type === "ANNUAL" ? terms : null;
          const suffix = plan.type === "MONTHLY" ? "/month" : plan.type === "ANNUAL" ? "/year" : "";
          return {
            id: plan.id,
            type: plan.type,
            label: purchasePlanLabel(plan.type),
            amount: money(promotion?.finalMinor ?? terms.amountMinor) + suffix,
            originalAmount: promotion ? money(terms.amountMinor) + suffix : undefined,
            detail: plan.type === "PERPETUAL" ? "Lifetime use" : plan.type === "MONTHLY" ? "Customer-authorized monthly renewal" : "Customer-authorized annual renewal",
            savings: promotion
              ? `${formatPercent(promotion.discountBps)} OFF · YOU SAVE ${money(promotion.discountMinor)}`
              : annual
                ? `Save ${formatPercent(annual.discountBps)} (${money(annual.savingsMinor)})`
                : undefined,
            effectiveMonthly: !promotion && annual && annual.effectiveMonthlyMinor !== null
              ? `Equivalent to ${money(annual.effectiveMonthlyMinor)}/month`
              : undefined,
          };
        }));
      return <article className="card grid gap-8 p-8 lg:grid-cols-[1fr_1.1fr]" key={edition.id}>
        <div>
          <p className="text-sm font-bold uppercase text-[#8cc8f5]">{edition.name} Edition</p>
          <p className="mt-3 text-[#a8b5c4]">{edition.description}</p>
          <h2 className="mt-6 text-lg font-black">Included capabilities</h2>
          <ul className="mt-3 list-disc pl-5 text-sm text-[#d5dbe5]">{Array.isArray(edition.features) && edition.features.map((feature) => <li key={String(feature)}>{String(feature)}</li>)}</ul>
          <p className="mt-5 text-sm">Up to {edition.maxUsers} authorized user(s), {edition.maxDevicesPerUser} device(s) each.</p>
          <p className="mt-1 text-sm text-[#a8b5c4]">Updates: {edition.updatePolicy.replaceAll("_", " ").toLowerCase()}</p>
        </div>
        <div><div className="mb-5 rounded-xl border border-[#3d75a7]/50 bg-[#213a53]/60 p-4"><p className="mb-3 text-sm font-semibold">Try this edition free for 7 days. Each account is eligible for one trial per product per calendar year.</p><TrialStartButton editionId={edition.id} accounts={accounts.map((account) => ({ id: account.id, name: account.displayName }))}/></div><PurchasePlanSelector plans={plans} signedIn={Boolean(session)} /></div>
      </article>;
    }))}</div>
  </section>;
}

function purchasePlanLabel(type: "PERPETUAL" | "MONTHLY" | "ANNUAL") {
  return type === "PERPETUAL" ? "Perpetual" : type === "MONTHLY" ? "Monthly" : "Annual";
}

function money(minor: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(minor / 100);
}
function formatPercent(bps: number) {
  return `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;
}
