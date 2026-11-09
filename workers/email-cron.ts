/**
 * Dispatch an explicitly enabled Cloudflare scheduled event through the
 * existing CRON_SECRET-protected email.outbox endpoint on the same Worker.
 *
 * This module does not register a Cron Trigger. Infrastructure activation,
 * external email permission and purchase-confirmation opt-in remain separate.
 */
export type EmailOutboxCronEnvironment = Readonly<{
  enabled: unknown;
  cronSecret: unknown;
  appUrl: unknown;
  selfService: { fetch(request: Request): Promise<Response> } | undefined;
}>;

export async function invokeEmailOutboxCron(
  env: EmailOutboxCronEnvironment,
): Promise<"DISABLED" | "COMPLETED"> {
  // An installed Worker code release never starts a live mail job by default.
  if (env.enabled !== "true") return "DISABLED";

  if (typeof env.cronSecret !== "string" || env.cronSecret.length < 32) {
    throw new Error("EMAIL_OUTBOX_CRON_SECRET_UNAVAILABLE");
  }
  if (!env.selfService || typeof env.selfService.fetch !== "function") {
    throw new Error("EMAIL_OUTBOX_CRON_SELF_SERVICE_UNAVAILABLE");
  }
  if (typeof env.appUrl !== "string") {
    throw new Error("EMAIL_OUTBOX_CRON_APP_URL_INVALID");
  }

  let url: URL;
  try { url = new URL("/api/cron/email-outbox", env.appUrl); }
  catch { throw new Error("EMAIL_OUTBOX_CRON_APP_URL_INVALID"); }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("EMAIL_OUTBOX_CRON_APP_URL_INVALID");
  }

  // Service binding, not a public fetch. The secret stays in Authorization.
  // The existing route validates it using timing-safe comparison, and its
  // scheduler provides per-window idempotency, locks and retry accounting.
  const response = await env.selfService.fetch(new Request(url, {
    method: "POST",
    headers: { authorization: "Bearer " + env.cronSecret },
  }));
  if (!response.ok) throw new Error("EMAIL_OUTBOX_CRON_HTTP_" + response.status);

  let result: unknown;
  try { result = await response.json(); }
  catch { throw new Error("EMAIL_OUTBOX_CRON_INVALID_RESPONSE"); }
  if (!result || typeof result !== "object") {
    throw new Error("EMAIL_OUTBOX_CRON_INVALID_RESPONSE");
  }

  const outcome = result as Record<string, unknown>;
  if (outcome.succeeded === true || outcome.duplicate === true) {
    return "COMPLETED";
  }
  // A route-level HTTP 200 is not proof that the scheduled job succeeded.
  throw new Error("EMAIL_OUTBOX_CRON_JOB_UNSUCCESSFUL");
}
