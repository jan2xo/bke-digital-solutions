import type { EmailMessage, EmailProvider } from "./contracts";
import { EmailDeliveryError } from "./failures";
import { DEFAULT_EMAIL_SEND_TIMEOUT_MS, withEmailSendDeadline } from "./send-deadline";

export const CLOUDFLARE_EMAIL_SEND_RESOURCE = "bke.email.cloudflare.send";

export type CloudflareEmailSend = (message: EmailMessage) => Promise<unknown>;

const QUOTA_REJECTIONS = new Map<string, "RATE_LIMITED" | "QUOTA_EXCEEDED">([
  ["E_RATE_LIMIT_EXCEEDED", "RATE_LIMITED"],
  ["E_DAILY_LIMIT_EXCEEDED", "QUOTA_EXCEEDED"],
]);

const KNOWN_REJECTIONS = new Map<string, EmailDeliveryError["safe"]["category"]>([
  ["E_VALIDATION_ERROR", "PROVIDER_REJECTED"],
  ["E_FIELD_MISSING", "PROVIDER_REJECTED"],
  ["E_TOO_MANY_RECIPIENTS", "PROVIDER_REJECTED"],
  ["E_TOO_MANY_ATTACHMENTS", "PROVIDER_REJECTED"],
  ["E_SENDER_NOT_VERIFIED", "SENDER_REJECTED"],
  ["E_RECIPIENT_NOT_ALLOWED", "INVALID_RECIPIENT"],
  ["E_RECIPIENT_SUPPRESSED", "INVALID_RECIPIENT"],
  ["E_ACCOUNT_SUSPENDED", "PROVIDER_REJECTED"],
  ["E_SENDER_DOMAIN_NOT_AVAILABLE", "SENDER_REJECTED"],
  ["E_CONTENT_TOO_LARGE", "PROVIDER_REJECTED"],
  ["E_HEADER_NOT_ALLOWED", "PROVIDER_REJECTED"],
  ["E_HEADER_USE_API_FIELD", "PROVIDER_REJECTED"],
  ["E_HEADER_VALUE_INVALID", "PROVIDER_REJECTED"],
  ["E_HEADER_VALUE_TOO_LONG", "PROVIDER_REJECTED"],
  ["E_HEADER_NAME_INVALID", "PROVIDER_REJECTED"],
  ["E_HEADERS_TOO_LARGE", "PROVIDER_REJECTED"],
  ["E_HEADERS_TOO_MANY", "PROVIDER_REJECTED"],
]);

function providerCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as Record<string, unknown>).code;
  return typeof code === "string" ? code : undefined;
}

function messageId(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const id = (result as Record<string, unknown>).messageId;
  return typeof id === "string" && id.trim().length > 0;
}

function uncertain(provider: string): EmailDeliveryError {
  return new EmailDeliveryError({
    provider,
    category: "DELIVERY_UNCONFIRMED",
  });
}

function knownRejection(code: string): EmailDeliveryError | undefined {
  const category = KNOWN_REJECTIONS.get(code);
  return category
    ? new EmailDeliveryError(
        { provider: "cloudflare", category },
        { acceptance: "REJECTED", retry: "STOP", fallbackEligible: false },
      )
    : undefined;
}

export function createCloudflareEmailProvider(options: Readonly<{
  sendPrimary?: CloudflareEmailSend;
  resendFallback?: EmailProvider;
  timeoutMs?: number;
}>): EmailProvider {
  const timeoutMs = options.timeoutMs ?? DEFAULT_EMAIL_SEND_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > DEFAULT_EMAIL_SEND_TIMEOUT_MS) {
    throw new RangeError("Invalid email send timeout");
  }

  const withDeadline = <T>(operation: () => Promise<T>, provider: string) =>
    withEmailSendDeadline(operation, provider, timeoutMs);

  return Object.freeze({
    async send(message: EmailMessage): Promise<void> {
      if (!options.sendPrimary) {
        throw new EmailDeliveryError(
          { provider: "cloudflare", category: "PROVIDER_UNAVAILABLE" },
          { acceptance: "REJECTED", retry: "RETRY", fallbackEligible: false, preCall: true },
        );
      }

      try {
        const result = await withDeadline(() => options.sendPrimary!(message), "cloudflare");
        if (!messageId(result)) throw uncertain("cloudflare");
        return;
      } catch (error) {
        const code = providerCode(error);
        const quotaCategory = code ? QUOTA_REJECTIONS.get(code) : undefined;
        if (quotaCategory) {
          const rejection = new EmailDeliveryError(
            { provider: "cloudflare", category: quotaCategory },
            { acceptance: "REJECTED", retry: "RETRY", fallbackEligible: true },
          );
          if (!options.resendFallback) throw rejection;
          try {
            await withDeadline(() => options.resendFallback!.send(message), "resend");
            return;
          } catch (fallbackError) {
            if (
              fallbackError instanceof EmailDeliveryError &&
              fallbackError.policy.acceptance === "REJECTED"
            ) {
              throw fallbackError;
            }
            throw uncertain("resend");
          }
        }

        if (code) {
          const rejection = knownRejection(code);
          if (rejection) throw rejection;
        }

        // Unknown codes, timeouts, transport failures, and delivery failures may have
        // occurred after acceptance. Never fallback or retry them automatically.
        if (error instanceof EmailDeliveryError) throw uncertain("cloudflare");
        throw uncertain("cloudflare");
      }
    },
  });
}
