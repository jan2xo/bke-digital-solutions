export { dispatchEmailOutbox } from "./outbox-dispatch";
export type {
  EmailOutboxDispatchOptions,
  EmailOutboxDispatchResult,
} from "./outbox-dispatch";
export {
  EmailDeliveryError,
  normalizeEmailFailure,
  safeEmailFailureCode,
} from "./failures";
export type { EmailFailureCategory, SafeEmailFailure } from "./failures";
export {
  createLoggingEmailProvider,
  createResendEmailProvider,
} from "./resend-provider";
export type {
  ResendClientFactory,
  ResendEmailConfiguration,
} from "./resend-provider";
export type {
  EmailMessage,
  EmailOutboxRecord,
  EmailOutboxStatus,
  EmailOutboxStore,
  EmailProvider,
} from "./contracts";

export { createCloudflareEmailProvider, CLOUDFLARE_EMAIL_SEND_RESOURCE } from "./cloudflare-provider";
export type { CloudflareEmailSend } from "./cloudflare-provider";
export { parseEmailSender } from "./sender";
export type { EmailSender } from "./sender";
export type { EmailDeliveryPolicy } from "./failures";
