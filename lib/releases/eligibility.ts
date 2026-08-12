export const CUSTOMER_RELEASE_LIFECYCLES = ["STABLE", "LTS"] as const;

export function isCustomerReleaseEligible(release: { lifecycle: string; active: boolean; publishedAt: Date | null }) {
  return release.active && Boolean(release.publishedAt) && CUSTOMER_RELEASE_LIFECYCLES.includes(release.lifecycle as typeof CUSTOMER_RELEASE_LIFECYCLES[number]);
}
