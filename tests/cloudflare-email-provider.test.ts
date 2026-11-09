import { describe, expect, it, vi } from "vitest";
import type { EmailMessage, EmailProvider } from "../platform/email/contracts";
import { createCloudflareEmailProvider } from "../platform/email/cloudflare-provider";
import { EmailDeliveryError } from "../platform/email/failures";
import {
  createResendEmailProvider,
  DEFAULT_EMAIL_SEND_TIMEOUT_MS,
  type ResendClientFactory,
} from "../platform/email/resend-provider";

const message: EmailMessage = {
  to: "customer@example.com",
  subject: "Invoice",
  text: "Your invoice is ready.",
  idempotencyKey: "outbox-row-17",
};

function createFakeResendProvider(
  send: (message: Readonly<{ from: string; to: string; subject: string; text: string }>, options?: Readonly<{ idempotencyKey: string }>) => Promise<Readonly<{ data?: unknown; error?: unknown }>>,
  timeoutMs = DEFAULT_EMAIL_SEND_TIMEOUT_MS,
) {
  const createClient: ResendClientFactory = () => ({ emails: { send } });
  return createResendEmailProvider({
    resolveConfiguration: async () => ({
      apiKey: "private-key",
      senderName: "BKE",
      senderEmail: "support@example.com",
    }),
    createClient,
    timeoutMs,
  });
}

describe("Cloudflare primary email transport", () => {
  it("passes optional HTML to Resend while retaining the identical plain-text alternative and idempotency", async () => {
    const send = vi.fn(async () => ({ data: { id: "resend-rendered" } }));
    const provider = createFakeResendProvider(send);
    await provider.send({ ...message, html: "<table><tr><td>Receipt</td></tr></table>" });
    expect(send).toHaveBeenCalledWith(
      {
        from: "BKE <support@example.com>",
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: "<table><tr><td>Receipt</td></tr></table>",
      },
      { idempotencyKey: "outbox-row-17" },
    );
  });

  it("accepts a valid Cloudflare result without invoking Resend", async () => {
    const primary = vi.fn(async () => ({ messageId: "cf-message-1" }));
    const fallback: EmailProvider = { send: vi.fn(async () => undefined) };
    const provider = createCloudflareEmailProvider({ sendPrimary: primary, resendFallback: fallback });

    await expect(provider.send(message)).resolves.toBeUndefined();
    expect(primary).toHaveBeenCalledWith(message);
    expect(fallback.send).not.toHaveBeenCalled();
  });

  it.each([
    ["E_RATE_LIMIT_EXCEEDED", "RATE_LIMITED"],
    ["E_DAILY_LIMIT_EXCEEDED", "QUOTA_EXCEEDED"],
  ] as const)("falls back only for explicit safe quota rejection %s", async (code, category) => {
    const primary = vi.fn(async () => { throw Object.assign(new Error("provider detail must not escape"), { code }); });
    const fallback: EmailProvider = { send: vi.fn(async () => undefined) };
    const provider = createCloudflareEmailProvider({ sendPrimary: primary, resendFallback: fallback });

    await expect(provider.send(message)).resolves.toBeUndefined();
    expect(fallback.send).toHaveBeenCalledWith(message);

    const rejected = createCloudflareEmailProvider({ sendPrimary: primary });
    await expect(rejected.send(message)).rejects.toMatchObject({
      safe: { provider: "cloudflare", category },
      policy: { acceptance: "REJECTED", retry: "RETRY", fallbackEligible: true },
    });
  });

  it("does not fall back for recipient suppression or account restrictions", async () => {
    for (const code of ["E_RECIPIENT_SUPPRESSED", "E_RECIPIENT_NOT_ALLOWED", "E_ACCOUNT_SUSPENDED"]) {
      const fallback: EmailProvider = { send: vi.fn(async () => undefined) };
      const provider = createCloudflareEmailProvider({
        sendPrimary: async () => { throw Object.assign(new Error("raw secret detail"), { code }); },
        resendFallback: fallback,
      });
      const result = provider.send(message);
      await expect(result).rejects.toMatchObject({
        name: "EmailDeliveryError",
        policy: { acceptance: "REJECTED", retry: "STOP", fallbackEligible: false },
      });
      expect(fallback.send).not.toHaveBeenCalled();
      await expect(result).rejects.not.toThrow("raw secret detail");
    }
  });

  it.each([
    ["unknown rejection", async () => { throw Object.assign(new Error("SECRET-RAW"), { code: "E_INTERNAL_SERVER_ERROR" }); }],
    ["malformed success", async () => ({ accepted: true })],
    ["missing result", async () => undefined],
  ])("stops with safe DELIVERY_UNCONFIRMED after %s", async (_label, sendPrimary) => {
    const fallback: EmailProvider = { send: vi.fn(async () => undefined) };
    const provider = createCloudflareEmailProvider({ sendPrimary, resendFallback: fallback });

    await expect(provider.send(message)).rejects.toMatchObject({
      safe: { provider: "cloudflare", category: "DELIVERY_UNCONFIRMED" },
      policy: { acceptance: "UNKNOWN", retry: "STOP", fallbackEligible: false },
    });
    expect(fallback.send).not.toHaveBeenCalled();
  });

  it("times out a never-settling primary, ignores its late completion, and never falls back", async () => {
    vi.useFakeTimers();
    try {
      let resolveLate!: (value: unknown) => void;
      const pending = new Promise<unknown>((resolve) => { resolveLate = resolve; });
      const fallback: EmailProvider = { send: vi.fn(async () => undefined) };
      const provider = createCloudflareEmailProvider({
        sendPrimary: vi.fn(() => pending),
        resendFallback: fallback,
        timeoutMs: 1_000,
      });
      const sending = provider.send(message);

      const rejection = expect(sending).rejects.toMatchObject({
        safe: { provider: "cloudflare", category: "DELIVERY_UNCONFIRMED" },
        policy: { acceptance: "UNKNOWN", retry: "STOP" },
      });
      await vi.advanceTimersByTimeAsync(1_000);
      await rejection;
      resolveLate({ messageId: "accepted-after-timeout" });
      await Promise.resolve();
      expect(fallback.send).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds a never-settling Resend fallback and stops as unconfirmed", async () => {
    vi.useFakeTimers();
    try {
      const fallback: EmailProvider = { send: vi.fn(() => new Promise<void>(() => {})) };
      const provider = createCloudflareEmailProvider({
        sendPrimary: async () => { throw Object.assign(new Error("quota"), { code: "E_RATE_LIMIT_EXCEEDED" }); },
        resendFallback: fallback,
        timeoutMs: 1_000,
      });
      const sending = provider.send(message);

      const rejection = expect(sending).rejects.toMatchObject({
        safe: { provider: "resend", category: "DELIVERY_UNCONFIRMED" },
        policy: { acceptance: "UNKNOWN", retry: "STOP" },
      });
      await vi.advanceTimersByTimeAsync(1_000);
      await rejection;
      expect(fallback.send).toHaveBeenCalledWith(message);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails before any provider attempt when the primary binding is absent", async () => {
    const fallback: EmailProvider = { send: vi.fn(async () => undefined) };
    const provider = createCloudflareEmailProvider({ resendFallback: fallback });

    await expect(provider.send(message)).rejects.toMatchObject({
      safe: { provider: "cloudflare", category: "PROVIDER_UNAVAILABLE" },
      policy: { acceptance: "REJECTED", retry: "RETRY", fallbackEligible: false, preCall: true },
    });
    expect(fallback.send).not.toHaveBeenCalled();
  });

  it("stops after an uncertain Resend result and preserves the outbox idempotency key", async () => {
    const send = vi.fn(async () => { throw new Error("timeout containing SECRET"); });
    const resend = createFakeResendProvider(send);
    const provider = createCloudflareEmailProvider({
      sendPrimary: async () => { throw Object.assign(new Error("quota"), { code: "E_RATE_LIMIT_EXCEEDED" }); },
      resendFallback: resend,
    });

    await expect(provider.send(message)).rejects.toMatchObject({
      safe: { provider: "resend", category: "DELIVERY_UNCONFIRMED" },
      policy: { acceptance: "UNKNOWN", retry: "STOP", fallbackEligible: false },
    });
    expect(send).toHaveBeenCalledWith(
      { from: "BKE <support@example.com>", to: message.to, subject: message.subject, text: message.text },
      { idempotencyKey: "outbox-row-17" },
    );
  });

  it.each([408, 409, 499, 500, 504] as const)("treats Resend HTTP %s errors as delivery uncertain", async (statusCode) => {
    const resend = createFakeResendProvider(async () => ({
      error: { statusCode, message: "sensitive provider response" },
    }));
    await expect(resend.send(message)).rejects.toMatchObject({
      safe: { provider: "resend", category: "DELIVERY_UNCONFIRMED" },
      policy: { acceptance: "UNKNOWN", retry: "STOP" },
    });
    await expect(resend.send(message)).rejects.not.toThrow("sensitive provider response");
  });

  it("treats malformed Resend status and malformed success as delivery uncertain", async () => {
    const malformedStatus = createFakeResendProvider(async () => ({
      error: { statusCode: "429", message: "not a typed HTTP rejection" },
    }));
    await expect(malformedStatus.send(message)).rejects.toMatchObject({
      safe: { category: "DELIVERY_UNCONFIRMED" },
      policy: { acceptance: "UNKNOWN", retry: "STOP" },
    });

    const malformedSuccess = createFakeResendProvider(async () => ({}));
    await expect(malformedSuccess.send(message)).rejects.toMatchObject({
      safe: { provider: "resend", category: "DELIVERY_UNCONFIRMED" },
      policy: { acceptance: "UNKNOWN", retry: "STOP" },
    });
  });

  it("uses only explicit definite Resend 4xx rejections as rejected outcomes", async () => {
    const rateLimited = createFakeResendProvider(async () => ({ error: { statusCode: 429 } }));
    await expect(rateLimited.send(message)).rejects.toMatchObject({
      safe: { category: "RATE_LIMITED", status: 429 },
      policy: { acceptance: "REJECTED", retry: "RETRY", fallbackEligible: false },
    });
    const forbidden = createFakeResendProvider(async () => ({ error: { statusCode: 403 } }));
    await expect(forbidden.send(message)).rejects.toMatchObject({
      safe: { category: "AUTHENTICATION_FAILED", status: 403 },
      policy: { acceptance: "REJECTED", retry: "STOP", fallbackEligible: false },
    });
  });

  it("makes unknown certainty terminal even when an invalid retry/fallback policy is requested", () => {
    const error = new EmailDeliveryError(
      { provider: "cloudflare", category: "DELIVERY_UNCONFIRMED" },
      { acceptance: "UNKNOWN", retry: "RETRY", fallbackEligible: true },
    );
    expect(error.policy).toEqual({
      acceptance: "UNKNOWN",
      retry: "STOP",
      fallbackEligible: false,
      preCall: false,
    });

    for (const category of ["PROVIDER_TIMEOUT", "PROVIDER_UNAVAILABLE", "UNKNOWN_PROVIDER_ERROR"] as const) {
      const ambiguous = new EmailDeliveryError({ provider: "resend", category });
      expect(ambiguous.policy).toEqual({
        acceptance: "UNKNOWN",
        retry: "STOP",
        fallbackEligible: false,
        preCall: false,
      });
    }

    const provenMissingConfig = new EmailDeliveryError(
      { provider: "cloudflare", category: "PROVIDER_UNAVAILABLE" },
      { acceptance: "REJECTED", retry: "RETRY", fallbackEligible: true, preCall: true },
    );
    expect(provenMissingConfig.policy).toEqual({
      acceptance: "REJECTED",
      retry: "RETRY",
      fallbackEligible: false,
      preCall: true,
    });
  });

  it("bounds a never-settling direct Resend call without reporting success", async () => {
    vi.useFakeTimers();
    try {
      const provider = createResendEmailProvider({
        resolveConfiguration: async () => ({ apiKey: "test-only", senderName: "BKE", senderEmail: "support@example.com" }),
        createClient: () => ({ emails: { send: () => new Promise(() => {}) } }),
        timeoutMs: 1_000,
      });
      const rejection = expect(provider.send(message)).rejects.toMatchObject({
        safe: { provider: "resend", category: "DELIVERY_UNCONFIRMED" },
        policy: { acceptance: "UNKNOWN", retry: "STOP" },
      });
      await vi.advanceTimersByTimeAsync(1_000);
      await rejection;
    } finally { vi.useRealTimers(); }
  });

  it("does not expose Cloudflare provider error details", async () => {
    const provider = createCloudflareEmailProvider({
      sendPrimary: async () => { throw Object.assign(new Error("raw message id and secret"), { code: "E_UNKNOWN_SECRET" }); },
    });
    const result = provider.send(message);
    await expect(result).rejects.toBeInstanceOf(EmailDeliveryError);
    await expect(result).rejects.not.toThrow("raw message id and secret");
  });
});
