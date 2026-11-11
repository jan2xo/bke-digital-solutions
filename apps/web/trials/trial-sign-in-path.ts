/** Keep trial sign-in on the product selected before Google authentication. */
export function trialSignInHref(productSlug: string): string {
  const productPath = `/products/${encodeURIComponent(productSlug)}`;
  return `/login?returnTo=${encodeURIComponent(productPath)}`;
}
