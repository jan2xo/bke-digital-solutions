import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentLifecycleError } from "@bke/payments/logic/payment-errors";

const race = vi.hoisted(() => ({
  eventId: "evt_failure_after_process_commit",
  status: "RECEIVED" as string,
  transactionStarted: false,
  rejectTransaction: null as null | ((reason?: unknown) => void),
  updateWhere: null as null | Record<string, unknown>,
}));

vi.mock("@/platform/host/db", () => ({
  db: {
    $transaction: vi.fn(() => new Promise((_resolve, reject) => {
      race.transactionStarted = true;
      race.rejectTransaction = reject;
    })),
    webhookEvent: {
      updateMany: vi.fn(async (input: {
        where: { provider: string; externalEventId: string; status: { in: string[] } };
        data: { status: string };
      }) => {
        race.updateWhere = input.where;
        if (input.where.provider !== "paymongo" || input.where.externalEventId !== race.eventId ||
            !input.where.status.in.includes(race.status)) {
          return { count: 0 };
        }
        race.status = input.data.status;
        return { count: 1 };
      }),
      // This deliberately models the old unconditional write so a regression
      // from updateMany back to update still changes status and fails the assertion.
      update: vi.fn(async (input: { data: { status: string } }) => {
        race.status = input.data.status;
        return {};
      }),
    },
  },
}));

vi.mock("@/apps/web/payments/webhook-ingestion", () => ({
  ingestPaymentWebhook: vi.fn(async () => ({
    duplicate: false,
    event: {
      providerEventRecordId: "provider-event-race",
      provider: "paymongo",
      eventId: race.eventId,
      type: "payment.paid",
      externalPaymentId: "pay_race",
      paymentIntentId: "pi_race",
      reference: "order_race",
      amountMinor: 1000,
      currency: "PHP",
      livemode: false,
      occurredAt: new Date("2026-11-06T00:00:00.000Z"),
      receivedAt: new Date("2026-11-06T00:00:00.000Z"),
    },
  })),
}));
vi.mock("@/apps/web/licensing/commercial-lease", () => ({ issueCommercialLease: vi.fn() }));
vi.mock("@/apps/web/licensing/entitlement-management", () => ({ fulfillOrderLicensing: vi.fn() }));
vi.mock("@/platform/host/security/crypto", () => ({ decryptLicenseKey: vi.fn(), sha256: vi.fn() }));
vi.mock("@/apps/web/payments/compatibility-provider", () => ({ paymentProvider: { name: "paymongo" } }));
vi.mock("@/apps/web/payments/settlement-transaction", () => ({ reactToPaidSettlement: vi.fn() }));
vi.mock("@/apps/web/payments/webhook-event-policy", () => ({ ignoredNonFinancialPaymentEventCode: vi.fn(() => null) }));
vi.mock("@/apps/web/notifications/center", () => ({ persistNotification: vi.fn() }));
vi.mock("@/apps/web/entitlements/refund-revocation", () => ({ revokeOrderEntitlements: vi.fn() }));
vi.mock("@/platform/persistence/generated/prisma/client", () => ({
  Prisma: { PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error { code = "OTHER"; } },
}));

import { processPaymentWebhook } from "../apps/web/payments/webhook-processing";

describe("webhook terminal-state race protection", () => {
  beforeEach(() => {
    race.status = "RECEIVED";
    race.transactionStarted = false;
    race.rejectTransaction = null;
    race.updateWhere = null;
    vi.clearAllMocks();
  });

  it("does not let a late failed payment transaction downgrade a concurrently processed webhook", async () => {
    const processing = processPaymentWebhook(Buffer.from("raw fixture"), new Headers());
    await vi.waitFor(() => expect(race.transactionStarted).toBe(true));
    const rejectTransaction = race.rejectTransaction;
    expect(rejectTransaction).toBeTypeOf("function");

    // A second delivery committed successfully while this payment transaction was
    // unresolved. Now release the older transaction with a retryable failure.
    race.status = "PROCESSED";
    rejectTransaction!(new PaymentLifecycleError("PAYMENT_PROCESSING_RETRYABLE", true));

    await expect(processing).rejects.toMatchObject({ code: "PAYMENT_PROCESSING_RETRYABLE" });
    expect(race.updateWhere).toEqual({
      provider: "paymongo",
      externalEventId: race.eventId,
      status: { in: ["RECEIVED", "FAILED"] },
    });
    expect(race.status).toBe("PROCESSED");
  });
});
