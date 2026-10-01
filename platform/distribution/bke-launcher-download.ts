const BKE_RELEASE_DOWNLOAD_PATTERN =
  /^\/jan2xo\/bke-launcher\/releases\/download\/[^/]+\/BKE-[^/]+\.exe$/;

export function resolveBkePublicDownloadUrl(
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  const value = environment.BKE_PUBLIC_DOWNLOAD_URL?.trim();
  if (!value) return null;

  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !BKE_RELEASE_DOWNLOAD_PATTERN.test(url.pathname)
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}
