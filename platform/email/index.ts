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
