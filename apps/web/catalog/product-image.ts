const rawImagePath = /^\/jan2xo\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.(?:png|jpe?g|webp)$/i;

export function resolveProductImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 500 || value.trim() !== value) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.hostname !== "raw.githubusercontent.com" || url.port !== "" ||
      url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "" ||
      url.href !== value || !rawImagePath.test(url.pathname)) return null;
  return url.href;
}

export function isLegacyProductImageObjectKey(value: unknown, productId: string): value is string {
  if (typeof value !== "string" || !productId) return false;
  const escapedId = productId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("^products/" + escapedId + "/images/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(?:png|jpe?g|webp)$", "i").test(value);
}