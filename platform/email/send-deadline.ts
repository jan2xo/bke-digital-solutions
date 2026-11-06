import { EmailDeliveryError } from "./failures";

export const DEFAULT_EMAIL_SEND_TIMEOUT_MS = 15_000;

/** A deadline bounds waiting; it cannot prove that a provider did not accept. */
export async function withEmailSendDeadline<T>(
  operation: () => Promise<T>,
  provider: string,
  timeoutMs = DEFAULT_EMAIL_SEND_TIMEOUT_MS,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > DEFAULT_EMAIL_SEND_TIMEOUT_MS) {
    throw new RangeError("Invalid email send timeout");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new EmailDeliveryError({
      provider, category: "DELIVERY_UNCONFIRMED",
    })), timeoutMs);
  });
  try {
    // Promise.race observes late settlement too; it never starts a fallback.
    return await Promise.race([Promise.resolve().then(operation), deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
