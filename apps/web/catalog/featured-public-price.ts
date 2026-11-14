// Homepage presentation only. Prices and promotions are resolved by canonical Commerce
// capabilities before they reach this selector; never recalculate checkout totals here.
type PlanType = "PERPETUAL" | "MONTHLY" | "SEMI_ANNUAL" | "ANNUAL";

export type FeaturedPublicPlanQuote = {
  planId: string;
  editionName: string;
  planType: PlanType;
  baseMinor: number;
  promotion: {
    finalMinor: number;
    discountMinor: number;
    discountBps: number;
  } | null;
};

function money(minor: number) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency", currency: "PHP",
  }).format(minor / 100);
}

function term(type: PlanType) {
  return type === "MONTHLY" ? "/month" :
    type === "SEMI_ANNUAL" ? "/6 months" :
    type === "ANNUAL" ? "/year" : " one-time";
}

function formatPercent(bps: number) {
  return `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;
}

export function selectFeaturedPublicPrice(quotes: readonly FeaturedPublicPlanQuote[]) {
  if (quotes.length === 0) return null;

  // Display a genuine public offer if one exists; it need not be the least
  // expensive billing term. Thus "Offer", never a misleading "From", for promos.
  const offers = quotes.filter(quote =>
    quote.promotion !== null &&
    quote.promotion.discountMinor > 0 &&
    quote.promotion.finalMinor >= 0 &&
    quote.promotion.finalMinor < quote.baseMinor,
  );
  const amount = (quote: FeaturedPublicPlanQuote) =>
    offers.length ? (quote.promotion?.finalMinor ?? quote.baseMinor) : quote.baseMinor;
  const selected = [...(offers.length ? offers : quotes)].sort((a, b) =>
    amount(a) - amount(b) || a.planId.localeCompare(b.planId),
  )[0];
  const promotion = offers.length ? selected.promotion : null;
  const suffix = term(selected.planType);
  return {
    priceLabel: `${promotion ? "Offer" : "From"} ${money(promotion?.finalMinor ?? selected.baseMinor)}${suffix}`,
    originalPriceLabel: promotion ? `${money(selected.baseMinor)}${suffix}` : null,
    discountLabel: promotion ? `${formatPercent(promotion.discountBps)} OFF` : null,
    planLabel: `${selected.editionName} edition`,
  };
}
