import { LandingExperience } from "@/app/landing-experience";
import { db } from "@/lib/db";
import { resolvePurchasePlan } from "@/lib/pricing";
import { getSiteContent } from "@/lib/site-content";

export default async function Home() {
  const content = await getSiteContent();
  const products = await db.product.findMany({
    where: { active: true, archivedAt: null },
    include: {
      prices: { where: { active: true }, orderBy: { amountMinor: "asc" }, take: 1 },
      editions: { where: { active: true }, include: { purchasePlans: { where: { active: true }, include: { monthlySource: true } } } },
    },
    orderBy: [{ featured: "desc" }, { publishedAt: "desc" }, { createdAt: "desc" }],
    take: 3,
  });

  const cards = products.map((product) => {
    const plans = product.editions.flatMap((edition) => edition.purchasePlans);
    const starting = plans.map((plan) => resolvePurchasePlan(plan).amountMinor).sort((a, b) => a - b)[0] ?? product.prices[0]?.amountMinor;
    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      summary: product.summary,
      type: product.type,
      priceLabel: starting === undefined ? "Explore solution" : `From ${money(starting)}`,
    };
  });

  return <LandingExperience content={content} products={cards} />;
}

function money(minor: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(minor / 100);
}
