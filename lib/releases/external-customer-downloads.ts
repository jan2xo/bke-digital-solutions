type ExternalDownloadMap = Record<string, string>;

function configuredExternalDownloads(): ExternalDownloadMap {
  const raw = process.env.CUSTOMER_EXTERNAL_DOWNLOAD_URLS?.trim();
  if (!raw) return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => {
        const [productId, value] = entry;
        if (!productId || typeof value !== "string") return false;
        try {
          return new URL(value).protocol === "https:";
        } catch {
          return false;
        }
      }),
    );
  } catch {
    return {};
  }
}

export function resolveExternalCustomerDownloadUrl(productId: string): string | null {
  return configuredExternalDownloads()[productId] ?? null;
}
