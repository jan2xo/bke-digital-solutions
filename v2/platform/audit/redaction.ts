const FORBIDDEN_AUDIT_METADATA_KEY = /password|passphrase|secret|token|api.?key|access.?key|private.?key|license.?key|authorization|cookie|signature|checkout.?url|payload|request.?body/i;

export function redactAuditMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAuditMetadata);

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        FORBIDDEN_AUDIT_METADATA_KEY.test(key)
          ? "[REDACTED]"
          : redactAuditMetadata(nested),
      ]),
    );
  }

  return value;
}
