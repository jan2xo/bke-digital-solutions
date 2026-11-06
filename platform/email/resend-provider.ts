import { Resend } from "resend";
import type { EmailMessage, EmailProvider } from "./contracts";
import { EmailDeliveryError, normalizeEmailFailure } from "./failures";
import { DEFAULT_EMAIL_SEND_TIMEOUT_MS, withEmailSendDeadline } from "./send-deadline";

export { DEFAULT_EMAIL_SEND_TIMEOUT_MS } from "./send-deadline";
export type ResendEmailConfiguration = Readonly<{
  apiKey: string; senderName: string; senderEmail: string;
}>;
type ResendClientLike = Readonly<{ emails: Readonly<{
  send(
    message: Readonly<{ from: string; to: string; subject: string; text: string }>,
    options?: Readonly<{ idempotencyKey: string }>,
  ): Promise<Readonly<{ data?: unknown; error?: unknown }>>;
}> }>;
export type ResendClientFactory = (apiKey: string) => ResendClientLike;

function unconfirmed(): EmailDeliveryError {
  return new EmailDeliveryError({ provider: "resend", category: "DELIVERY_UNCONFIRMED" });
}
const definiteRejectionStatuses = new Set([400, 401, 403, 404, 405, 413, 415, 422, 429]);

export function createResendEmailProvider(options: Readonly<{
  resolveConfiguration: () => Promise<ResendEmailConfiguration>;
  createClient?: ResendClientFactory;
  timeoutMs?: number;
}>): EmailProvider {
  const createClient = options.createClient ??
    ((apiKey: string) => new Resend(apiKey) as unknown as ResendClientLike);
  const timeoutMs = options.timeoutMs ?? DEFAULT_EMAIL_SEND_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > DEFAULT_EMAIL_SEND_TIMEOUT_MS) {
    throw new RangeError("Invalid email send timeout");
  }
  return Object.freeze({
    async send(message: EmailMessage): Promise<void> {
      let configuration: ResendEmailConfiguration;
      let client: ResendClientLike;
      try {
        configuration = await options.resolveConfiguration();
        client = createClient(configuration.apiKey);
      } catch (error) {
        if (error instanceof EmailDeliveryError) throw error;
        const safe = normalizeEmailFailure(error);
        throw new EmailDeliveryError(
          { provider: "resend", category: safe.category },
          { acceptance: "REJECTED", retry: "RETRY", fallbackEligible: false, preCall: true },
        );
      }
      let result: Readonly<{ data?: unknown; error?: unknown }>;
      try {
        result = await withEmailSendDeadline(() => client.emails.send({
          from: `${configuration.senderName} <${configuration.senderEmail}>`,
          to: message.to, subject: message.subject, text: message.text,
        }, message.idempotencyKey ? { idempotencyKey: message.idempotencyKey } : undefined), "resend", timeoutMs);
      } catch {
        throw unconfirmed();
      }
      if (result?.error) {
        const safe = normalizeEmailFailure(result.error);
        // In particular, 409 may mean this key is already in flight/accepted.
        // Server errors/timeouts/unknown statuses never prove non-acceptance.
        if (!safe.status || !definiteRejectionStatuses.has(safe.status)) throw unconfirmed();
        throw new EmailDeliveryError(
          { provider: "resend", category: safe.category, status: safe.status },
          { acceptance: "REJECTED", retry: safe.status === 429 ? "RETRY" : "STOP", fallbackEligible: false },
        );
      }
      const data = result?.data;
      if (!data || typeof data !== "object" ||
          !("id" in data) || typeof data.id !== "string" || !data.id.trim()) throw unconfirmed();
    },
  });
}

export function createLoggingEmailProvider(
  log: (message: EmailMessage) => void = message =>
    console.info(`[development email] queued: ${message.subject}`),
): EmailProvider {
  return Object.freeze({ async send(message: EmailMessage) { log(message); } });
}
