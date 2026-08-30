import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { applyOfferDiscount, calculateAnnualPricing, purchasePlanLabel, resolvePurchasePlan } from "@/lib/pricing";
import { findPublicPromotion } from "@/lib/offers";
import { CheckoutStartButton } from "@/components/checkout-start-button";
import { checkoutLegalTypes, pendingReacceptance, publishedLegalDocuments } from "@/lib/legal/service";

export default async function CheckoutReview({ searchParams }: { searchParams: Promise<{ purchasePlanId?: string }> }) {
  const { purchasePlanId } = await searchParams;
  if (!purchasePlanId) notFound();

  const returnTo = `/checkout?purchasePlanId=${encodeURIComponent(purchasePlanId)}`;
  const user = await requireUser().catch(() => redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`));
  if (!user.emailVerified) redirect("/verify-email");
  if ((await pendingReacceptance(user.id)).length) redirect(`/legal/accept?returnTo=${encodeURIComponent(returnTo)}`);

  const [plan, accounts] = await Promise.all([
    db.purchasePlan.findFirst({
      where: { id: purchasePlanId, active: true, edition: { active: true, product: { active: true, archivedAt: null } } },
      include: { monthlySource: true, edition: { include: { product: true } } },
    }),
    db.customerAccount.findMany({
      where: {
        lifecycleState: "ACTIVE",
        OR: [
          { ownerId: user.id },
          { memberships: { some: { userId: user.id, role: { in: ["OWNER", "BILLING"] } } } },
        ],
      },
      select: { id: true, displayName: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  if (!plan) notFound();

  const legalDocuments = await publishedLegalDocuments(checkoutLegalTypes(plan.type));
  if (legalDocuments.length !== checkoutLegalTypes(plan.type).length) throw new Error("LEGAL_DOCUMENTS_UNAVAILABLE");

  const terms = resolvePurchasePlan(plan);
  const annual = plan.type === "ANNUAL" ? calculateAnnualPricing(plan.monthlySource!.amountMinor!, plan.annualDiscountBps ?? 0) : null;
  const publicPromotion = await findPublicPromotion(db, {
    id: plan.id,
    type: plan.type,
    editionId: plan.editionId,
    productId: plan.edition.productId,
    currency: plan.currency,
  });
  const promotional = publicPromotion ? applyOfferDiscount(terms.amountMinor, publicPromotion.discountBps) : null;

  return (
    <section className="mx-auto max-w-2xl px-4 py-14 motion-fade-up">
      <p className="font-bold text-[#ffd15a]">Checkout review</p>
      <h1 className="mt-2 text-4xl font-black">{plan.edition.product.name}</h1>
      <div className="card mt-8 border-[#2d3850] bg-[#10161e] grid gap-4 p-7">
        <Row label="Edition" value={plan.edition.name} />
        <Row label="Purchase plan" value={purchasePlanLabel(plan.type)} />
        <Row label="Billing interval" value={plan.type === "PERPETUAL" ? "One-time" : plan.type === "MONTHLY" ? "Monthly" : "Annual"} />
        <Row label="Renewal" value={plan.renewalBehavior === "NONE" ? "No renewal" : "Customer authorizes each renewal checkout"} />
        <Row label="User limit" value={String(plan.edition.maxUsers)} />
        <Row label="Device limit" value={`${plan.edition.maxDevicesPerUser} per user`} />
        {annual && (
          <>
            <Row label="Annual savings" value={money(annual.savingsMinor)} />
            <Row label="Effective monthly" value={money(annual.effectiveMonthlyMinor)} />
          </>
        )}
        <div className="border-t pt-4">
          <Row label="Catalog total" value={money(terms.amountMinor)} />
        </div>
        {promotional && publicPromotion && (
          <>
            <Row label="Promotional offer" value={`${publicPromotion.name} (${formatPercent(publicPromotion.discountBps)} OFF)`} />
            <Row label="Promotional discount" value={`−${money(promotional.discountAmountMinor)}`} />
          </>
        )}
        <div className="border-t pt-4">
          <Row label="Amount due" value={money(promotional?.finalAmountMinor ?? terms.amountMinor)} />
        </div>
      </div>
      <p className="info-surface mt-5 p-4 text-sm leading-6">
        The server revalidates the selected offer and calculates the final payable amount before payment. Recurring charges are not automatic; subscription renewals require a new customer-authorized checkout.
      </p>
      <CheckoutStartButton
        purchasePlanId={plan.id}
        automaticOfferIdentifier={publicPromotion?.id}
        accounts={accounts.map((account) => ({ id: account.id, name: account.displayName }))}
        legalDocuments={legalDocuments.map((document) => ({
          versionId: document.currentPublishedVersionId!,
          type: document.documentType,
          title: document.title,
          slug: document.slug,
        }))}
      />
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-[#a8b5c4]">{label}</span>
      <strong className="text-right">{value}</strong>
    </div>
  );
}

function money(minor: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(minor / 100);
}

function formatPercent(bps: number) {
  return `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;
}
