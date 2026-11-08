/**
 * Fail closed when an unapproved working draft was accidentally published.
 * A PUBLISHED database state is not evidence of legal or owner approval.
 *
 * Do not use this policy as a replacement for the legal review workflow:
 * commercial agreements still require separate approval and publication.
 */
export function isUnapprovedLegalReviewDraft(
  title: string,
  markdownContent: string,
): boolean {
  if (/\bREVIEW DRAFT\b/i.test(title)) return true;
  const firstSection = markdownContent.slice(0, 1200);
  return /^#\s+.*\bREVIEW DRAFT\b/im.test(firstSection)
    || /\bWorking draft for BKE Digital Solutions Staging\b/i.test(firstSection);
}

/**
 * Checkout test notices must never become commercial agreements just because
 * an operator sets PAYMONGO_LIVEMODE=true or copies a Staging database.
 */
export function isNoncommercialCheckoutTestNotice(
  title: string,
  markdownContent: string,
): boolean {
  const header = markdownContent.slice(0, 1600);
  return /^(?:Mock Checkout Test|Staging Test)\b/i.test(title.trim())
    || /\bnoncommercial BKE Digital Solutions checkout testing\b/i.test(header)
    || /\bno real money is charged\b/i.test(header)
    || /\bpayments are in mock mode\b/i.test(header)
    || /\bnot the commercial service.s production terms\b/i.test(header);
}

export function isCheckoutLegalNoticeAllowed(
  title: string,
  markdownContent: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (isUnapprovedLegalReviewDraft(title, markdownContent)) return false;
  const realPayment = environment.DEPLOYMENT_ENV === "production"
    || environment.PAYMONGO_LIVEMODE === "true";
  if (realPayment && isNoncommercialCheckoutTestNotice(title, markdownContent)) return false;
  return true;
}
