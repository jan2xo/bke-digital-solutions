import { Resend } from "resend";
import type { EmailMessage, EmailProvider } from "./contracts";
import { EmailDeliveryError, normalizeEmailFailure } from "./failures";

export type ResendEmailConfiguration = Readonly<{
  apiKey: string;
  senderName: string;
  senderEmail: string;
}>;

type ResendClientLike = Readonly<{
  emails: Readonly<{
    send(
      message: Readonly<{ from: string; to: string; subject: string; text: string }>,
      options?: Readonly<{ idempotencyKey: string }>,
    ): Promise<Readonly<{ error?: unknown }>>;
  }>;
}>;

export type ResendClientFactory = (apiKey: string) => ResendClientLike;

export function createResendEmailProvider(options: Readonly<{
  resolveConfiguration: () => Promise<ResendEmailConfiguration>;
  createClient?: ResendClientFactory;
}>): EmailProvider {
  const createClient =
    options.createClient ??
    ((apiKey: string) => new Resend(apiKey) as unknown as ResendClientLike);

  return Object.freeze({
    async send(message: EmailMessage): Promise<void> {
      const configuration = await options.resolveConfiguration();
      const client = createClient(configuration.apiKey);

      try {
        const result = await client.emails.send(
          {
            from: `${configuration.senderName} <${configuration.senderEmail}>`,
            to: message.to,
            subject: message.subject,
            text: message.text,
          },
          message.idempotencyKey
            ? { idempotencyKey: message.idempotencyKey }
            : undefined,
        );

        if (result.error) {
          throw new EmailDeliveryError(normalizeEmailFailure(result.error));
        }
      } catch (error) {
        if (error instanceof EmailDeliveryError) throw error;
        throw new EmailDeliveryError(normalizeEmailFailure(error));
      }
    },
  });
}

export function createLoggingEmailProvider(
  log: (message: EmailMessage) => void = (message) =>
    console.info(`[development email] queued: ${message.subject}`),
): EmailProvider {
  return Object.freeze({
    async send(message: EmailMessage): Promise<void> {
      log(message);
    },
  });
}
