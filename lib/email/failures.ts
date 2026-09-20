export type EmailFailureCategory = "QUOTA_EXCEEDED" | "RATE_LIMITED" | "AUTHENTICATION_FAILED" | "SENDER_REJECTED" | "INVALID_RECIPIENT" | "PROVIDER_TIMEOUT" | "PROVIDER_UNAVAILABLE" | "PROVIDER_REJECTED" | "UNKNOWN_PROVIDER_ERROR";
export type SafeEmailFailure = { provider: string; category: EmailFailureCategory; status?: number; requestId?: string };
export class EmailDeliveryError extends Error {
  readonly safe: SafeEmailFailure;
  constructor(safe: SafeEmailFailure) { super(safe.category); this.name = "EmailDeliveryError"; this.safe = safe; }
}
export function normalizeEmailFailure(error: unknown, provider = "resend"): SafeEmailFailure {
  const value = (error && typeof error === "object" ? error : {}) as Record<string, unknown>;
  const status = typeof value.statusCode === "number" ? value.statusCode : typeof value.status === "number" ? value.status : undefined;
  const name = String(value.name ?? value.code ?? "").toLowerCase();
  const message = String(value.message ?? "").toLowerCase();
  let category: EmailFailureCategory = "UNKNOWN_PROVIDER_ERROR";
  if (status === 408 || status === 504 || name.includes("timeout") || message.includes("timeout")) category = "PROVIDER_TIMEOUT";
  else if (status === 401 || status === 403 || /auth|api.?key|unauthoriz/.test(name + message)) category = "AUTHENTICATION_FAILED";
  else if (status === 429 || /rate.?limit/.test(name + message)) category = "RATE_LIMITED";
  else if (/quota|limit exceeded/.test(name + message)) category = "QUOTA_EXCEEDED";
  else if (/recipient|email address|invalid.*to/.test(name + message)) category = "INVALID_RECIPIENT";
  else if (/sender|from|domain/.test(name + message)) category = "SENDER_REJECTED";
  else if (typeof status === "number" && status >= 500) category = "PROVIDER_UNAVAILABLE";
  else if (typeof status === "number" && status >= 400) category = "PROVIDER_REJECTED";
  const requestId = typeof value.headers === "object" && value.headers ? String((value.headers as Record<string, unknown>)["x-request-id"] ?? "") || undefined : typeof value.requestId === "string" ? value.requestId : undefined;
  return { provider, category, ...(status === undefined ? {} : { status }), ...(requestId ? { requestId: requestId.slice(0, 128) } : {}) };
}
export function safeEmailFailureCode(error: unknown): string { return error instanceof EmailDeliveryError ? error.safe.category : normalizeEmailFailure(error).category; }
