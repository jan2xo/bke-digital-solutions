import {
  COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID,
  type CommercePurchasePlanPricingCapability,
} from "@bke/commerce/contracts/purchase-plan-pricing.contract";
import Link from "next/link";
import { db } from "@/platform/host/db";
import { getV2WebApplication } from "@/apps/web/runtime";
import { resolveProductImageUrl } from "@/apps/web/catalog/product-image";

export const metadata = { title: "Products" };

export default async function ProductsPage() {
  const [products, application] = await Promise.all([
    db.product.findMany({
      where: { active: true },
      include: { editions: { where: { active: true }, include: { purchasePlans: { where: { active: true }, include: { monthlySource: true } } } } },
    }),
    getV2WebApplication(),
  ]);
  const pricing = application.get<CommercePurchasePlanPricingCapability>(
    COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID,
  );

  return <section className="shell products-page motion-fade-up">
    <p className="font-bold text-[#ffe08a]">Product catalog</p>
    <h1 className="products-page-title">Software for work that matters.</h1>
    {products.length > 0 ? (
      <div className="products-grid motion-stagger">{products.map((product) => {
        const plans = product.editions.flatMap((edition) => edition.purchasePlans);
        const starting = plans
          .map((plan) => {
            const result = pricing.resolve(plan);
            if (result.status === "FAILED") throw new Error(result.code);
            return result.pricing.amountMinor;
          })
          .sort((a, b) => a - b)[0];
        const imageUrl = resolveProductImageUrl(product.imageKey);
      return <article className="card products-card" key={product.id}>
          {imageUrl && <img className="mb-5 max-h-48 w-full rounded-xl object-contain" src={imageUrl} alt="" />}
          <p className="text-xs font-bold tracking-widest text-[#ffe08a]">{product.type}</p>
          <h2>{product.name}</h2>
          <p className="products-card-summary">{product.summary}</p>
          <p className="products-card-options">{product.editions.length} edition(s) · {plans.length} purchase option(s)</p>
          {starting !== undefined && <p className="products-card-price">From {money(starting)}</p>}
          <Link prefetch={false} className="button products-card-action" href={`/products/${product.slug}`}>Choose edition and plan</Link>
        </article>;
      })}</div>
    ) : (
      <div className="empty-products-state products-empty-state">
        <p className="eyebrow eyebrow-yellow">CATALOG UPDATE</p>
        <h2>No products are available right now.</h2>
        <p>Please check back later.</p>
        <Link prefetch={false} className="text-link" href="/">Back to home <span>→</span></Link>
      </div>
    )}
  </section>;
}

function money(minor: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(minor / 100);
}
