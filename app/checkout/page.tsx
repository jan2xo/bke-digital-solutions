import {
  CATALOG_LOOKUP_CAPABILITY_ID,
  type CatalogLookupCapability,
} from "@bke/catalog/contracts/catalog.contract";
import {
  COMMERCE_PURCHASE_PLAN_LOOKUP_CAPABILITY_ID,
  type CommercePurchasePlanLookupCapability,
} from "@bke/commerce/contracts/purchase-plan-lookup.contract";
import {
  COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID,
  type CommercePurchasePlanPricingCapability,
} from "@bke/commerce/contracts/purchase-plan-pricing.contract";
import {
  LEGAL_CHECKOUT_REQUIREMENTS_CAPABILITY_ID,
  type LegalCheckoutRequirementsCapability,
} from "@bke/legal/contracts/checkout-requirements.contract";
import {
  LEGAL_REACCEPTANCE_STATUS_CAPABILITY_ID,
  type LegalReacceptanceStatusCapability,
} from "@bke/legal/contracts/reacceptance-status.contract";
import { notFound, redirect } from "next/navigation";
import { CheckoutStartButton } from "@/components/checkout-start-button";
import { listPurchaseAuthorizedAccounts } from "@/v2/apps/web/accounts/purchase-account-list";
import { currentIdentitySession } from "@/v2/apps/web/auth/session";
import { getV2WebApplication } from "@/v2/apps/web/runtime";

export default async function CheckoutReview({
  searchParams,
}: {
  searchParams: Promise<{ purchasePlanId?: string }>;
}) {
  const { purchasePlanId } = await searchParams;
  if (!purchasePlanId) notFound();

  const returnTo = `/checkout?purchasePlanId=${purchasePlanId}`;
  const session = await currentIdentitySession();
  if (!session) redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  const principal = session.principal;
  if (!principal.emailVerified) redirect("/verify-email");

  const application = await getV2WebApplication();
  const reacceptance = application.get<LegalReacceptanceStatusCapability>(
    LEGAL_REACCEPTANCE_STATUS_CAPABILITY_ID,
  );
  const reacceptanceStatus = await reacceptance.check({
    principalId: principal.id,
    principalEstablishedAt: principal.establishedAt,
  });
  if (reacceptanceStatus.status === "REACCEPTANCE_REQUIRED") {
    redirect(`/legal/accept?returnTo=${encodeURIComponent(returnTo)}`);
  }
  if (reacceptanceStatus.status === "FAILED") throw new Error(reacceptanceStatus.code);

  const planLookup = application.get<CommercePurchasePlanLookupCapability>(
    COMMERCE_PURCHASE_PLAN_LOOKUP_CAPABILITY_ID,
  );
  const planResult = await planLookup.find({ planId: purchasePlanId });
  if (planResult.status === "NOT_FOUND" || (planResult.status === "FOUND" && !planResult.plan.active)) {
    notFound();
  }
  if (planResult.status === "FAILED") throw new Error(planResult.code);
  const plan = planResult.plan;
  if (!plan.editionId) notFound();

  const pricingCapability = application.get<CommercePurchasePlanPricingCapability>(
    COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID,
  );
  const pricingResult = pricingCapability.resolve(plan);
  if (pricingResult.status === "FAILED") throw new Error(pricingResult.code);
  const terms = pricingResult.pricing;

  const catalog = application.get<CatalogLookupCapability>(CATALOG_LOOKUP_CAPABILITY_ID);
  const editionResult = await catalog.findEditionById(plan.editionId);
  if (editionResult.status === "NOT_FOUND" || (editionResult.status === "FOUND" && !editionResult.value.active)) {
    notFound();
  }
  if (editionResult.status === "FAILED") throw new Error(editionResult.code);
  const edition = editionResult.value;

  const productResult = await catalog.findProductById(edition.productId);
  if (
    productResult.status === "NOT_FOUND" ||
    (productResult.status === "FOUND" &&
      (!productResult.value.active || productResult.value.archivedAt !== null || !productResult.value.available))
  ) {
    notFound();
  }
  if (productResult.status === "FAILED") throw new Error(productResult.code);
  const product = productResult.value;

  const requirementsCapability = application.get<LegalCheckoutRequirementsCapability>(
    LEGAL_CHECKOUT_REQUIREMENTS_CAPABILITY_ID,
  );
  const requirementsResult = await requirementsCapability.resolve({ planType: plan.type });
  if (requirementsResult.status === "REJECTED") throw new Error(requirementsResult.code);
  if (requirementsResult.status === "FAILED") throw new Error(requirementsResult.code);
  const legalDocuments = requirementsResult.requirements;

  const authorizedAccounts = await listPurchaseAuthorizedAccounts(principal.id);
  const annual =
    plan.type === "ANNUAL"
      ? { savingsMinor: terms.savingsMinor, effectiveMonthlyMinor: terms.effectiveMonthlyMinor ?? 0 }
      : null;

  return (
    <section className="mx-auto max-w-2xl px-4 py-14 motion-fade-up">
      <p className="font-bold text-[#ffd15a]">Checkout review</p>
      <h1 className="mt-2 text-4xl font-black">{product.name}</h1>
      <div className="card mt-8 border-[#2d3850] bg-[#10161e] grid gap-4 p-7">
        <Row label="Edition" value={edition.name} />
        <Row label="Purchase plan" value={purchasePlanLabel(plan.type)} />
        <Row
          label="Billing interval"
          value={plan.type === "PERPETUAL" ? "One-time" : plan.type === "MONTHLY" ? "Monthly" : "Annual"}
        />
        <Row
          label="Renewal"
          value={plan.renewalBehavior === "NONE" ? "No renewal" : "Customer authorizes each renewal checkout"}
        />
        <Row label="User limit" value={String(edition.maxUsers)} />
        <Row label="Device limit" value={`${edition.maxDevicesPerUser} per user`} />
        {annual && (
          <>
            <Row label="Annual savings" value={money(annual.savingsMinor)} />
            <Row label="Effective monthly" value={money(annual.effectiveMonthlyMinor)} />
          </>
        )}
        <div className="border-t pt-4">
          <Row label="Catalog total" value={money(terms.amountMinor)} />
        </div>
      </div>
      <p className="info-surface mt-5 p-4 text-sm leading-6">
        The server validates any selected offer and calculates the final payable amount. Recurring charges are not automatic;
        subscription renewals require a new customer-authorized checkout.
      </p>
      <CheckoutStartButton
        purchasePlanId={plan.id}
        accounts={authorizedAccounts.map((account) => ({ id: account.id, name: account.displayName }))}
        legalDocuments={legalDocuments.map((document) => ({
          versionId: document.documentVersionId,
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

function purchasePlanLabel(type: "PERPETUAL" | "MONTHLY" | "ANNUAL") {
  return type === "PERPETUAL" ? "Perpetual" : type === "MONTHLY" ? "Monthly" : "Annual";
}

function money(minor: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(minor / 100);
}
