import "server-only";

import {
  createLoggingEmailProvider,
  createResendEmailProvider,
  dispatchEmailOutbox as dispatchPlatformEmailOutbox,
  type EmailOutboxDispatchOptions,
  type EmailOutboxRecord,
  type EmailOutboxStatus,
  type EmailOutboxStore,
  type EmailProvider,
} from "@/v2/platform/email";
import { getWebHostEnvironment } from "@/v2/apps/web/config/environment";
import { getPostgresPool } from "@/v2/apps/web/persistence/postgres";
import { resolveResendConfiguration } from "@/v2/apps/web/providers/capability";

function parseNodeEnv(value: string | undefined): "development" | "test" | "production" {
  const parsed = value ?? "development";
  if (parsed !== "development" && parsed !== "test" && parsed !== "production") {
    throw new Error("Invalid web host environment: NODE_ENV");
  }
  return parsed;
}

function parseEmailProvider(value: string | undefined): "log" | "resend" {
  const parsed = value ?? "log";
  if (parsed !== "log" && parsed !== "resend") {
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

const hostEnvironment = getWebHostEnvironment();
const nodeEnv = parseNodeEnv(process.env.NODE_ENV);
const emailProviderMode = parseEmailProvider(process.env.EMAIL_PROVIDER);
const deploymentEnvironment = parseDeploymentEnvironment(process.env.DEPLOYMENT_ENV);
if (deploymentEnvironment === "production" && emailProviderMode === "log") {
  throw new Error("Invalid web host environment: log email transport is forbidden in production");
}

const loggingProvider = createLoggingEmailProvider();
const resendProvider = createResendEmailProvider({ resolveConfiguration: resolveResendConfiguration });

const runtimeEmailProvider: EmailProvider = Object.freeze({
  async send(message) {
    const disabled =
      process.env.BKE_DISABLE_EXTERNAL_EMAIL === "true" ||
      (nodeEnv === "test" && !process.env.RESEND_SANDBOX_TO);
    const useLog = emailProviderMode !== "resend" && !process.env.RESEND_SANDBOX_TO;
    if (disabled || useLog) return loggingProvider.send(message);
    return resendProvider.send(message);
  },
});

function render(type: string, payload: Record<string, unknown>) {
  const order = String(payload.orderNumber ?? "");
  const invoice = String(payload.invoiceNumber ?? "");
  const renewalUrl = String(payload.renewalUrl ?? "");
  return type === "PAYMENT_RECEIPT"
    ? `Payment for order ${order} was confirmed.`
    : type === "INVOICE_ISSUED"
      ? `Commercial invoice ${invoice} is available in your customer portal.`
      : type === "LICENSE_ISSUED"
        ? `Your license for order ${order} is ready. View the full key in your secure portal.`
        : type === "PAYMENT_FAILED"
          ? `Payment for order ${order} failed. No license was issued.`
          : type === "REFUND_CONFIRMED"
            ? `The refund for order ${order} was confirmed and its access was revoked.`
            : type === "RENEWAL_REMINDER"
              ? `Your BKE subscription is approaching renewal. Authorize renewal from your secure portal: ${renewalUrl}`
              : type === "SUBSCRIPTION_EXPIRED"
                ? "Your BKE subscription has expired. Access remains governed by the current entitlement status in your portal."
                : type === "TRIAL_ENDING"
                  ? "Your BKE product trial is ending soon. Review available purchase plans in your portal."
                  : type === "TRIAL_EXPIRED"
                    ? "Your BKE product trial and grace period have expired."
                    : type === "LICENSE_EXPIRED"
                      ? "Your BKE license has expired and can no longer activate devices or authorize downloads."
                      : type === "SECURITY_SESSIONS_REVOKED"
                        ? "Administrator session access was revoked. If this was not you, reset your password and review the security dashboard."
                        : type === "SECURITY_NEW_SESSION"
                          ? "A new administrator session was created. Review the security dashboard if this was not you."
                          : type === "SECURITY_ACCOUNT_CHANGED"
                            ? "A high-impact administrator security setting changed. Review the security dashboard if this was not you."
                            : "BKE Digital Solutions account notification.";
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

const emailOutboxStore: EmailOutboxStore = Object.freeze({
  async recoverExpiredClaims(now) {
    const result = await getPostgresPool().query(
      `UPDATE "EmailOutbox"
          SET "status" = 'FAILED', "claimedBy" = NULL, "claimedAt" = NULL, "claimExpiresAt" = NULL
        WHERE "status" = 'PROCESSING' AND "claimExpiresAt" < $1`,
      [now],
    );
    return result.rowCount ?? 0;
  },

  async listDispatchable({ limit, maxAttempts }): Promise<readonly EmailOutboxRecord[]> {
    const result = await getPostgresPool().query<DispatchRow>(
      `SELECT "id", "status"::text AS "status", "attempts", "recipient", "subject", "type", "payload"
         FROM "EmailOutbox"
        WHERE "status" IN ('PENDING', 'FAILED') AND "attempts" < $1
        ORDER BY "createdAt" ASC
        LIMIT $2`,
      [maxAttempts, limit],
    );
    return result.rows.map((row) => Object.freeze({
      id: row.id,
      status: row.status,
      attempts: row.attempts,
      message: Object.freeze({
        to: row.recipient,
        subject: row.subject,
        text: render(row.type, row.payload),
      }),
    }));
  },

  async claim(input) {
    const result = await getPostgresPool().query(
      `UPDATE "EmailOutbox"
          SET "status" = 'PROCESSING', "claimedBy" = $4, "claimedAt" = $5, "claimExpiresAt" = $6
        WHERE "id" = $1 AND "status"::text = $2 AND "attempts" = $3`,
      [input.id, input.expectedStatus, input.expectedAttempts, input.workerId, input.claimedAt, input.claimExpiresAt],
    );
    return (result.rowCount ?? 0) > 0;
  },

  async markSent(input) {
    const result = await getPostgresPool().query(
      `UPDATE "EmailOutbox"
          SET "status" = 'SENT', "sentAt" = $3, "attempts" = $4, "lastError" = NULL,
              "claimedBy" = NULL, "claimedAt" = NULL, "claimExpiresAt" = NULL
        WHERE "id" = $1 AND "status" = 'PROCESSING' AND "claimedBy" = $2`,
      [input.id, input.workerId, input.sentAt, input.attempts],
    );
    return (result.rowCount ?? 0) > 0;
  },

  async markFailed(input) {
    const result = await getPostgresPool().query(
      `UPDATE "EmailOutbox"
          SET "status" = $3::"EmailOutboxStatus", "attempts" = $4, "lastError" = $5,
              "claimedBy" = NULL, "claimedAt" = NULL, "claimExpiresAt" = NULL
        WHERE "id" = $1 AND "status" = 'PROCESSING' AND "claimedBy" = $2`,
      [input.id, input.workerId, input.status, input.attempts, input.failureCode],
    );
    return (result.rowCount ?? 0) > 0;
  },
});

function tokenUrl(path: string, token: string) {
  const url = new URL(path, hostEnvironment.appUrl);
  url.searchParams.set("token", token);
  return url;
}

export async function sendVerificationEmail(email: string, token: string) {
  await runtimeEmailProvider.send({
    to: email,
    subject: "Verify your BKE Digital Solutions account",
    text: `Verify your account using this one-time link: ${tokenUrl("/api/auth/verify", token)}`,
  });
}

export async function sendMagicLink(email: string, token: string) {
  await runtimeEmailProvider.send({
    to: email,
    subject: "Your BKE Digital Solutions sign-in link",
    text: `Sign in using this one-time link (expires in 15 minutes): ${tokenUrl("/api/auth/magic/consume", token)}`,
  });
}

export async function sendPasswordReset(email: string, token: string) {
  await runtimeEmailProvider.send({
    to: email,
    subject: "Reset your BKE Digital Solutions password",
    text: `Reset your password using this one-time link (expires in 30 minutes): ${tokenUrl("/reset-password", token)}`,
  });
}

export async function sendAdministratorLoginCode(email: string, code: string, reference: string) {
  await runtimeEmailProvider.send({
    to: email,
    subject: `Your BKE administrator verification code [${reference}]`,
    text: `Your BKE administrator verification code is ${code}. Verification reference: ${reference}. It expires in 10 minutes and can be used only once. Only the newest requested code remains valid. If you did not request this code, do not share it and review your account security.`,
  });
}

export async function dispatchEmailOutbox(
  limit = 20,
  options: Readonly<{ workerId?: string; claimTtlMs?: number }> = {},
) {
  const platformOptions: EmailOutboxDispatchOptions = {
    limit,
    maxAttempts: 5,
    ...(options.workerId !== undefined ? { workerId: options.workerId } : {}),
    ...(options.claimTtlMs !== undefined ? { claimTtlMs: options.claimTtlMs } : {}),
    log: (event, result) => console.info(event, result),
  };
  return dispatchPlatformEmailOutbox(
    { store: emailOutboxStore, provider: runtimeEmailProvider },
    platformOptions,
  );
}
