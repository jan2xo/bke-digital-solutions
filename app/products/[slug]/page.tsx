import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { calculateAnnualPricing, purchasePlanLabel, resolvePurchasePlan } from "@/lib/pricing";
import { PurchasePlanSelector } from "@/components/purchase-plan-selector";
import { TrialStartButton } from "@/components/trial-start-button";

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await currentUser();
  const [product, accounts] = await Promise.all([
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
    user ? db.customerAccount.findMany({ where: { lifecycleState: "ACTIVE", OR: [{ ownerId: user.id }, { memberships: { some: { userId: user.id, role: { in: ["OWNER", "BILLING"] } } } }] }, select: { id: true, displayName: true }, orderBy: { createdAt: "asc" } }) : [],
  ]);
  if (!product?.active) notFound();

  return <section className="shell py-16">
    <p className="font-bold text-[#ffd15a]">{product.type}</p>
    <h1 className="mt-2 text-5xl font-black">{product.name}</h1>
    <p className="mt-6 max-w-3xl text-lg leading-8 text-[#a8b5c4]">{product.description}</p>
    <div className="mt-12 grid gap-8">{product.editions.map((edition) => {
      const plans = edition.purchasePlans
        .sort((a, b) => ["PERPETUAL", "MONTHLY", "ANNUAL"].indexOf(a.type) - ["PERPETUAL", "MONTHLY", "ANNUAL"].indexOf(b.type))
        .map((plan) => {
          const terms = resolvePurchasePlan(plan);
          const annual = plan.type === "ANNUAL" ? calculateAnnualPricing(plan.monthlySource!.amountMinor!, plan.annualDiscountBps ?? 0) : null;
          return {
            id: plan.id,
            type: plan.type,
            label: purchasePlanLabel(plan.type),
            amount: money(terms.amountMinor) + (plan.type === "MONTHLY" ? "/month" : plan.type === "ANNUAL" ? "/year" : ""),
            detail: plan.type === "PERPETUAL" ? "Lifetime use" : plan.type === "MONTHLY" ? "Customer-authorized monthly renewal" : "Customer-authorized annual renewal",
            savings: annual ? `Save ${(annual.discountBps / 100).toFixed(annual.discountBps % 100 ? 2 : 0)}% (${money(annual.savingsMinor)})` : undefined,
            effectiveMonthly: annual ? `Equivalent to ${money(annual.effectiveMonthlyMinor)}/month` : undefined,
          };
        });
      return <article className="card grid gap-8 p-8 lg:grid-cols-[1fr_1.1fr]" key={edition.id}>
        <div>
          <p className="text-sm font-bold uppercase text-[#3D75A7]">{edition.name} Edition</p>
          <p className="mt-3 text-[#a8b5c4]">{edition.description}</p>
          <h2 className="mt-6 text-lg font-black">Included capabilities</h2>
          <ul className="mt-3 list-disc pl-5 text-sm text-[#d5dbe5]">{Array.isArray(edition.features) && edition.features.map((feature) => <li key={String(feature)}>{String(feature)}</li>)}</ul>
          <p className="mt-5 text-sm">Up to {edition.maxUsers} authorized user(s), {edition.maxDevicesPerUser} device(s) each.</p>
          <p className="mt-1 text-sm text-[#a8b5c4]">Updates: {edition.updatePolicy.replaceAll("_", " ").toLowerCase()}</p>
        </div>
        <div><div className="mb-5 rounded-xl border border-[#3d75a7]/50 bg-[#213a53]/60 p-4"><p className="mb-3 text-sm font-semibold">Try this edition free for 7 days. Each account is eligible for one trial per product per calendar year.</p><TrialStartButton editionId={edition.id} accounts={accounts.map((account) => ({ id: account.id, name: account.displayName }))}/></div><PurchasePlanSelector plans={plans} signedIn={Boolean(user)} /></div>
      </article>;
    })}</div>
  </section>;
}

function money(minor: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(minor / 100);
}
