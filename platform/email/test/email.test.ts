import { describe, expect, it, vi } from "vitest";
import {
  EmailDeliveryError,
  createResendEmailProvider,
  dispatchEmailOutbox,
  normalizeEmailFailure,
} from "../index";
import type {
  EmailOutboxRecord,
  EmailOutboxStore,
  EmailProvider,
  ResendClientFactory,
} from "../index";

function outboxRecord(overrides: Partial<EmailOutboxRecord> = {}): EmailOutboxRecord {
  return {
    id: "email-1",
    status: "PENDING",
    attempts: 0,
    message: {
      to: "customer@example.com",
      subject: "Subject",
      text: "Body",
    },
    ...overrides,
  };
}

function storeFor(rows: readonly EmailOutboxRecord[]): EmailOutboxStore {
  return {
    recoverExpiredClaims: vi.fn(async () => 2),
    listDispatchable: vi.fn(async () => rows),
    claim: vi.fn(async () => true),
    markSent: vi.fn(async () => true),
    markFailed: vi.fn(async () => true),
  };
}

describe("V2 platform email", () => {
  it("dispatches with V1 defaults, claim recovery, and outbox-id idempotency", async () => {
    const row = outboxRecord();
    const store = storeFor([row]);
    const send = vi.fn(async () => undefined);
    const provider: EmailProvider = { send };
    const fixed = new Date("2026-09-05T01:00:00.000Z");

    const result = await dispatchEmailOutbox(
      { store, provider },
      { workerId: "worker-1", now: () => fixed },
    );

    expect(store.recoverExpiredClaims).toHaveBeenCalledWith(fixed);
    expect(store.listDispatchable).toHaveBeenCalledWith({ limit: 20, maxAttempts: 5 });
    expect(store.claim).toHaveBeenCalledWith({
      id: "email-1",
      expectedStatus: "PENDING",
      expectedAttempts: 0,
      workerId: "worker-1",
      claimedAt: fixed,
      claimExpiresAt: new Date("2026-09-05T01:05:00.000Z"),
    });
    expect(send).toHaveBeenCalledWith({
      to: "customer@example.com",
      subject: "Subject",
      text: "Body",
      idempotencyKey: "email-1",
    });
    expect(store.markSent).toHaveBeenCalledWith({
      id: "email-1",
      workerId: "worker-1",
      sentAt: fixed,
      attempts: 1,
    });
    expect(result).toEqual({
      selected: 1,
      recovered: 2,
      sent: 1,
      failed: 0,
      terminal: 0,
      skipped: 0,
      workerId: "worker-1",
    });
  });

  it("skips a row when the compare-and-swap claim loses the race", async () => {
    const store = storeFor([outboxRecord()]);
    store.claim = vi.fn(async () => false);
    const send = vi.fn(async () => undefined);

    const result = await dispatchEmailOutbox(
      { store, provider: { send } },
      { workerId: "worker-race" },
    );

    expect(send).not.toHaveBeenCalled();
    expect(store.markSent).not.toHaveBeenCalled();
    expect(store.markFailed).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });

  it("records safe retry failures and promotes the fifth attempt to terminal", async () => {
    const retryRow = outboxRecord({ id: "retry", status: "FAILED", attempts: 2 });
    const terminalRow = outboxRecord({ id: "terminal", status: "FAILED", attempts: 4 });
    const store = storeFor([retryRow, terminalRow]);
    const provider: EmailProvider = {
      async send() {
        throw new EmailDeliveryError({ provider: "resend", category: "RATE_LIMITED" });
      },
    };

    const result = await dispatchEmailOutbox(
      { store, provider },
      { workerId: "worker-failure" },
    );

    expect(store.markFailed).toHaveBeenNthCalledWith(1, {
      id: "retry",
      workerId: "worker-failure",
      status: "FAILED",
      attempts: 3,
      failureCode: "RATE_LIMITED",
    });
    expect(store.markFailed).toHaveBeenNthCalledWith(2, {
      id: "terminal",
      workerId: "worker-failure",
      status: "PERMANENTLY_FAILED",
      attempts: 5,
      failureCode: "RATE_LIMITED",
    });
    expect(result).toMatchObject({ failed: 2, terminal: 1, sent: 0, skipped: 0 });
  });

  it("normalizes provider failures without leaking provider error bodies", async () => {
    expect(normalizeEmailFailure({ status: 429, message: "rate limit exceeded" })).toEqual({
      provider: "resend",
      category: "RATE_LIMITED",
      status: 429,
    });

    const send = vi.fn(async () => ({
      error: { status: 401, message: "invalid api key SECRET-RAW-VALUE" },
    }));
    const createClient: ResendClientFactory = () => ({ emails: { send } });
    const provider = createResendEmailProvider({
      resolveConfiguration: async () => ({
        apiKey: "api-key",
        senderName: "BKE",
        senderEmail: "support@example.com",
      }),
      createClient,
    });

    await expect(
      provider.send({
        to: "customer@example.com",
        subject: "Hello",
        text: "Body",
        idempotencyKey: "outbox-1",
      }),
    ).rejects.toMatchObject({
      name: "EmailDeliveryError",
      safe: { category: "AUTHENTICATION_FAILED", status: 401 },
    });

    expect(send).toHaveBeenCalledWith(
      {
        from: "BKE <support@example.com>",
        to: "customer@example.com",
        subject: "Hello",
        text: "Body",
      },
      { idempotencyKey: "outbox-1" },
    );
  });
});
