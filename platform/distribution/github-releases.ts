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

export function githubVersionReleaseUrl(productId: string | null | undefined, version: string) {
  const repository = githubReleaseRepository(productId);
  if (!repository || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) return null;
  return `https://github.com/${repository}/releases/tag/v${encodeURIComponent(version)}`;
}
