import "server-only";

import {
  createLoggingEmailProvider,
  createCloudflareEmailProvider,
  CLOUDFLARE_EMAIL_SEND_RESOURCE,
  EmailDeliveryError,
  parseEmailSender,
  type CloudflareEmailSend,
  createResendEmailProvider,
  dispatchEmailOutbox as dispatchPlatformEmailOutbox,
  type EmailMessage,
  type EmailOutboxDispatchOptions,
  type EmailOutboxRecord,
  type EmailOutboxStatus,
  type EmailOutboxStore,
  type EmailProvider,
} from "@/platform/email";
import { operationResource } from "@/platform/host/operation-scope";
import { getPostgresPool } from "@/apps/web/persistence/postgres";
import { resolveResendConfiguration } from "@/apps/web/providers/capability";
import { purchaseConfirmationEmailEnabled, PURCHASE_CONFIRMATION_TYPE, renderPurchaseConfirmationEmail, renderPurchaseConfirmationEmailHtml } from "@/apps/web/email/purchase-confirmation";

function parseNodeEnv(value: string | undefined): "development" | "test" | "production" {
  const parsed = value ?? "development";
  if (parsed !== "development" && parsed !== "test" && parsed !== "production") {
    throw new Error("Invalid web host environment: NODE_ENV");
  }
  return parsed;
}

function parseEmailProvider(value: string | undefined): "log" | "resend" | "cloudflare" {
  const parsed = value ?? "log";
  if (parsed !== "log" && parsed !== "resend" && parsed !== "cloudflare") {
    throw new Error("Invalid web host environment: EMAIL_PROVIDER");
  }
  return parsed;
}

function parseDeploymentEnvironment(value: string | undefined): "development" | "test" | "staging" | "production" {
  const parsed = value ?? "development";
  if (parsed !== "development" && parsed !== "test" && parsed !== "staging" && parsed !== "production") {
    throw new Error("Invalid web host environment: DEPLOYMENT_ENV");
  }
  return parsed;
}

const loggingProvider = createLoggingEmailProvider();
const resendProvider = createResendEmailProvider({ resolveConfiguration: resolveResendConfiguration });

function runtimeProvider(): EmailProvider {
  const nodeEnv = parseNodeEnv(process.env.NODE_ENV);
  const mode = parseEmailProvider(process.env.EMAIL_PROVIDER);
  const deployment = parseDeploymentEnvironment(process.env.DEPLOYMENT_ENV);
  if (deployment === "production" && process.env.BKE_RUNTIME === "workers" && mode === "resend") {
    throw new Error("Workers production requires Cloudflare primary email; Resend is fallback only");
  }
  if (deployment === "production" &&
      (mode === "log" || process.env.BKE_DISABLE_EXTERNAL_EMAIL === "true")) {
    throw new Error("Production business email must have an enabled external transport");
  }
  const sandboxTo = process.env.RESEND_SANDBOX_TO?.trim();
  if (process.env.BKE_DISABLE_EXTERNAL_EMAIL === "true" || (nodeEnv === "test" && !sandboxTo)) {
    return loggingProvider;
  }
  if (mode === "log" && !sandboxTo) return loggingProvider;
  const selected = mode === "cloudflare"
    ? createCloudflareEmailProvider({
        sendPrimary: process.env.BKE_RUNTIME === "workers"
          ? operationResource<CloudflareEmailSend | undefined>(CLOUDFLARE_EMAIL_SEND_RESOURCE, () => undefined)
          : undefined,
        resendFallback: createResendEmailProvider({
          async resolveConfiguration() {
            const sender = parseEmailSender(process.env.EMAIL_FROM);
            const configuration = await resolveResendConfiguration();
            if (!sender || sender.email.toLowerCase() !== configuration.senderEmail.toLowerCase()) {
              throw new EmailDeliveryError(
                { provider: "resend", category: "SENDER_REJECTED" },
                { acceptance: "REJECTED", retry: "STOP", fallbackEligible: false, preCall: true },
              );
            }
            return configuration;
          },
        }),
      })
    : resendProvider;
  if (!sandboxTo) return selected;
  return Object.freeze({
    async send(message: EmailMessage) {
      if (message.to.toLowerCase() !== sandboxTo.toLowerCase()) {
        throw new EmailDeliveryError(
          { provider: "sandbox", category: "INVALID_RECIPIENT" },
          { acceptance: "REJECTED", retry: "STOP", fallbackEligible: false, preCall: true },
        );
      }
      return selected.send(message);
    },
  });
}

// Transport selection is lazy: queue-only imports never validate email settings.
export const emailProvider: EmailProvider = Object.freeze({
  async send(message: EmailMessage) { return runtimeProvider().send(message); },
});

const DURABLE_EMAIL_TYPES = Object.freeze([
  "INVOICE_ISSUED",
  "SECURITY_SESSIONS_REVOKED",
  "SECURITY_NEW_SESSION",
  "SECURITY_ACCOUNT_CHANGED",
] as const);

function render(type: string, payload: Record<string, unknown>) {
  const invoice = String(payload.invoiceNumber ?? "");
  switch (type) {
    case PURCHASE_CONFIRMATION_TYPE:
      return renderPurchaseConfirmationEmail(payload, process.env.APP_URL);
    case "INVOICE_ISSUED":
      return `Commercial invoice ${invoice} is available in your customer portal.`;
    case "SECURITY_SESSIONS_REVOKED":
      return "Administrator session access was revoked. If this was not you, secure your Google account and review the security dashboard.";
    case "SECURITY_NEW_SESSION":
      return "A new administrator session was created. Review the security dashboard if this was not you.";
    case "SECURITY_ACCOUNT_CHANGED":
      return "A high-impact administrator security setting changed. Review the security dashboard if this was not you.";
    default:
      throw new Error("EMAIL_TYPE_NOT_DELIVERABLE");
  }
}

type DispatchRow = Readonly<{
  id: string;
  status: EmailOutboxStatus;
  attempts: number;
  recipient: string;
  subject: string;
  type: string;
  payload: Record<string, unknown>;
}>;

export function createPostgresEmailOutboxStore(getPool: typeof getPostgresPool = getPostgresPool): EmailOutboxStore {
  return Object.freeze({
  async recoverExpiredClaims(now: Date) {
    const result = await getPool().query(
      `UPDATE "EmailOutbox"
          SET "status" = 'PERMANENTLY_FAILED', "lastError" = 'DELIVERY_UNCONFIRMED',
              "attempts" = "attempts" + 1,
              "claimedBy" = NULL, "claimedAt" = NULL, "claimExpiresAt" = NULL
        WHERE "status" = 'PROCESSING' AND "claimExpiresAt" < $1`,
      [now],
    );
    return result.rowCount ?? 0;
  },

  async listDispatchable(
    { limit, maxAttempts, deduplicationKey }: Readonly<{ limit: number; maxAttempts: number; deduplicationKey?: string }>,
  ): Promise<readonly EmailOutboxRecord[]> {
    const result = await getPool().query<DispatchRow>(
      `SELECT "id", "status"::text AS "status", "attempts", "recipient", "subject", "type", "payload"
         FROM "EmailOutbox"
        WHERE "status" IN ('PENDING', 'FAILED')
          AND "attempts" < $1
          AND "type" = ANY($3::text[])
          AND ($4::text IS NULL OR ("type" = $5 AND "deduplicationKey" = $4))
        ORDER BY "createdAt" ASC
        LIMIT $2`,
      [maxAttempts, limit, purchaseConfirmationEmailEnabled()
        ? [...DURABLE_EMAIL_TYPES, PURCHASE_CONFIRMATION_TYPE]
        : DURABLE_EMAIL_TYPES,
        deduplicationKey ?? null, PURCHASE_CONFIRMATION_TYPE],
    );
    return result.rows.map((row) => Object.freeze({
      id: row.id,
      status: row.status,
      attempts: row.attempts,
      message: Object.freeze({
        to: row.recipient,
        subject: row.subject,
        text: render(row.type, row.payload),
        ...(row.type === PURCHASE_CONFIRMATION_TYPE
          ? { html: renderPurchaseConfirmationEmailHtml(row.payload, process.env.APP_URL) }
          : {}),
        idempotencyKey: row.id,
      }),
    }));
  },

  async claim(input: Parameters<EmailOutboxStore["claim"]>[0]) {
    const result = await getPool().query(
      `UPDATE "EmailOutbox"
          SET "status" = 'PROCESSING', "claimedBy" = $4, "claimedAt" = $5, "claimExpiresAt" = $6
        WHERE "id" = $1 AND "status"::text = $2 AND "attempts" = $3`,
      [input.id, input.expectedStatus, input.expectedAttempts, input.workerId, input.claimedAt, input.claimExpiresAt],
    );
    return (result.rowCount ?? 0) > 0;
  },

  async markSent(input: Parameters<EmailOutboxStore["markSent"]>[0]) {
    const result = await getPool().query(
      `UPDATE "EmailOutbox"
          SET "status" = 'SENT', "sentAt" = $3, "attempts" = $4, "lastError" = NULL,
              "claimedBy" = NULL, "claimedAt" = NULL, "claimExpiresAt" = NULL
        WHERE "id" = $1 AND "status" = 'PROCESSING' AND "claimedBy" = $2`,
      [input.id, input.workerId, input.sentAt, input.attempts],
    );
    return (result.rowCount ?? 0) > 0;
  },

  async markFailed(input: Parameters<EmailOutboxStore["markFailed"]>[0]) {
    const result = await getPool().query(
      `UPDATE "EmailOutbox"
          SET "status" = $3, "attempts" = $4, "lastError" = $5,
              "claimedBy" = NULL, "claimedAt" = NULL, "claimExpiresAt" = NULL
        WHERE "id" = $1 AND "status" = 'PROCESSING' AND "claimedBy" = $2`,
      [input.id, input.workerId, input.status, input.attempts, input.failureCode],
    );
    return (result.rowCount ?? 0) > 0;
  },
});
}

const emailOutboxStore = createPostgresEmailOutboxStore();

export async function dispatchEmailOutbox(
  limit = 20,
  options: Readonly<{ workerId?: string; claimTtlMs?: number; deduplicationKey?: string }> = {},
) {
  const platformOptions: EmailOutboxDispatchOptions = {
    limit,
    maxAttempts: 5,
    ...(options.workerId !== undefined ? { workerId: options.workerId } : {}),
    ...(options.claimTtlMs !== undefined ? { claimTtlMs: options.claimTtlMs } : {}),
    ...(options.deduplicationKey !== undefined ? { deduplicationKey: options.deduplicationKey } : {}),
    log: (event, result) => console.info(event, result),
  };
  return dispatchPlatformEmailOutbox(
    { store: emailOutboxStore, provider: runtimeProvider() },
    platformOptions,
  );
}

/** Only the verified post-commit webhook path may target this order-scoped row. */
export async function dispatchVerifiedPurchaseConfirmation(orderId: string) {
  if (!purchaseConfirmationEmailEnabled()) return;
  if (!/^[\w-]{1,160}$/.test(orderId)) throw new Error("PURCHASE_CONFIRMATION_ORDER_INVALID");
  return dispatchEmailOutbox(1, { deduplicationKey: `purchase-confirmed:${orderId}` });
}
