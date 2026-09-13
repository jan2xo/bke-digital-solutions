const forbidden = /password|passphrase|secret|token|api.?key|access.?key|private.?key|license.?key|authorization|cookie|signature|checkout.?url|payload|request.?body/i;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, forbidden.test(key) ? "[REDACTED]" : redact(nested)]),
    );
  }
  return value;
}
