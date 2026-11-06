const MAX_BASE64_PNG_LENGTH = 512 * 1024;
const PNG_DATA_URI_PREFIX = "data:image/png;base64,";
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const PNG_BASE64_SIGNATURE = "iVBORw0KGgo";

/** Accept a trusted transport URL or a bounded, correctly typed PNG data URI. */
export function parseCheckoutQrImage(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) return undefined;

  if (value.startsWith(PNG_DATA_URI_PREFIX)) {
    const encoded = value.slice(PNG_DATA_URI_PREFIX.length);
    if (
      encoded.length === 0 ||
      encoded.length > MAX_BASE64_PNG_LENGTH ||
      encoded.length % 4 !== 0 ||
      !BASE64_PATTERN.test(encoded) ||
      !encoded.startsWith(PNG_BASE64_SIGNATURE)
    ) {
      return undefined;
    }
    return value;
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}
