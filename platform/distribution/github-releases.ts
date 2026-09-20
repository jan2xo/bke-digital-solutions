const GITHUB_RELEASE_REPOSITORIES: Readonly<Record<string, string>> = {
  airstack: "jan2xo/BKE_AIR_STACK",
  "bke-air-stack": "jan2xo/BKE_AIR_STACK",
  "bke-render-dock": "jan2xo/BKE_RENDER_DOCK",
};

export function githubReleaseRepository(productId: string | null | undefined) {
  if (!productId) return null;
  return GITHUB_RELEASE_REPOSITORIES[productId] ?? null;
}

export function githubLatestReleaseUrl(productId: string | null | undefined) {
  const repository = githubReleaseRepository(productId);
  return repository ? `https://github.com/${repository}/releases/latest` : null;
}
