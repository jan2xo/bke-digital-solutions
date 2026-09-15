const GITHUB_RELEASE_REPOSITORIES: Readonly<Record<string, string>> = {
  airstack: "jan2xo/BKE_AIR_STACK",
  "bke-air-stack": "jan2xo/BKE_AIR_STACK",
  "bke-render-dock": "jan2xo/BKE_RENDER_DOCK",
};

export function githubLatestReleaseUrl(productId: string | null | undefined) {
  if (!productId) return null;
  const repository = GITHUB_RELEASE_REPOSITORIES[productId];
  return repository ? `https://github.com/${repository}/releases/latest` : null;
}
