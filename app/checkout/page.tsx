import {
  COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID,
  type CommercePurchasePlanPricingCapability,
} from "@bke/commerce/contracts/purchase-plan-pricing.contract";
import { redirect, notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { CheckoutStartButton } from "@/components/checkout-start-button";
import { checkoutLegalTypes, pendingReacceptance, publishedLegalDocuments } from "@/lib/legal/service";
import { getV2WebApplication } from "@/v2/apps/web/runtime";

export default async function CheckoutReview({ searchParams }: { searchParams: Promise<{ purchasePlanId?: string }> }) {
  const { purchasePlanId } = await searchParams;
  if (!purchasePlanId) notFound();
  const user = await requireUser().catch(() => redirect(`/login?returnTo=${encodeURIComponent(`/checkout?purchasePlanId=${purchasePlanId}`)}`));
  if (!user.emailVerified) redirect("/verify-email");
  if ((await pendingReacceptance(user.id)).length) redirect(`/legal/accept?returnTo=${encodeURIComponent(`/checkout?purchasePlanId=${purchasePlanId}`)}`);
  const [plan, accounts] = await Promise.all([
    db.purchasePlan.findFirst({
      where: { id: purchasePlanId, active: true, edition: { active: true, product: { active: true, archivedAt: null } } },
      include: { monthlySource: true, edition: { include: { product: true } } },
    }),
    db.customerAccount.findMany({
      where: { lifecycleState: "ACTIVE", OR: [{ ownerId: user.id }, { memberships: { some: { userId: user.id, role: { in: ["OWNER", "BILLING"] } } } }] },
      select: { id: true, displayName: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  if (!plan) notFound();
  const legalDocuments = await publishedLegalDocuments(checkoutLegalTypes(plan.type));
  if (legalDocuments.length !== checkoutLegalTypes(plan.type).length) throw new Error("LEGAL_DOCUMENTS_UNAVAILABLE");

  const application = await getV2WebApplication();
  const pricingCapability = application.get<CommercePurchasePlanPricingCapability>(
    COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID,
  );
  const pricingResult = pricingCapability.resolve(plan);
  if (pricingResult.status === "FAILED") throw new Error(pricingResult.code);
  const terms = pricingResult.pricing;
  const annual = plan.type === "ANNUAL"
    ? { savingsMinor: terms.savingsMinor, effectiveMonthlyMinor: terms.effectiveMonthlyMinor ?? 0 }
    : null;

  return <section className="mx-auto max-w-2xl px-4 py-14 motion-fade-up">
    <p className="font-bold text-[#ffd15a]">Checkout review</p>
    <h1 className="mt-2 text-4xl font-black">{plan.edition.product.name}</h1>
    <div className="card mt-8 border-[#2d3850] bg-[#10161e] grid gap-4 p-7">
      <Row label="Edition" value={plan.edition.name} />
      <Row label="Purchase plan" value={purchasePlanLabel(plan.type)} />
      <Row label="Billing interval" value={plan.type === "PERPETUAL" ? "One-time" : plan.type === "MONTHLY" ? "Monthly" : "Annual"} />
      <Row label="Renewal" value={plan.renewalBehavior === "NONE" ? "No renewal" : "Customer authorizes each renewal checkout"} />
      <Row label="User limit" value={String(plan.edition.maxUsers)} />
      <Row label="Device limit" value={`${plan.edition.maxDevicesPerUser} per user`} />
      {annual && <>
        <Row label="Annual savings" value={money(annual.savingsMinor)} />
        <Row label="Effective monthly" value={money(annual.effectiveMonthlyMinor)} />
      </>}
      <div className="border-t pt-4"><Row label="Catalog total" value={money(terms.amountMinor)} /></div>
    </div>
    <p className="info-surface mt-5 p-4 text-sm leading-6">The server validates any selected offer and calculates the final payable amount. Recurring charges are not automatic; subscription renewals require a new customer-authorized checkout.</p>
    <CheckoutStartButton
      purchasePlanId={plan.id}
      accounts={accounts.map((account) => ({ id: account.id, name: account.displayName }))}
      legalDocuments={legalDocuments.map((document) => ({ versionId: document.currentPublishedVersionId!, type: document.documentType, title: document.title, slug: document.slug }))}
    />
  </section>;
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-4"><span className="text-[#a8b5c4]">{label}</span><strong className="text-right">{value}</strong></div>;
}

function purchasePlanLabel(type: "PERPETUAL" | "MONTHLY" | "ANNUAL") {
  return type === "PERPETUAL" ? "Perpetual" : type === "MONTHLY" ? "Monthly" : "Annual";
}

function money(minor: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(minor / 100);
}
