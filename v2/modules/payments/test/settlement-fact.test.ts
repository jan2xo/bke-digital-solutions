import { describe, expect, it } from "vitest";
import type { PaymentsProviderEventType } from "../contracts/provider-event-ingestion.contract";
import type { PaymentsSettlementFactSnapshot } from "../contracts/settlement-fact.contract";
import type { PaymentsProviderEventRecord } from "../logic/provider-event-repository";
import { createPaymentsSettlementFactCapability } from "../logic/settlement-fact";
import type { PaymentsSettlementFactRepository } from "../logic/settlement-fact-repository";

type RepoOverrides = Partial<{
  type: PaymentsProviderEventType;
  livemode: boolean;
  checkout: string | null;
  reference: string | null;
  payment: string | null;
  amount: number | null;
  currency: string | null;
}>;

function repo(overrides: RepoOverrides = {}): PaymentsSettlementFactRepository {
  const event: PaymentsProviderEventRecord = {
    id: "event-row",
    provider: "fakepay",
    eventId: "evt_paid",
    payloadHash: "h",
    eventFingerprint: "f",
    rawType: "payment.paid",
    type: overrides.type ?? "payment.paid",
    externalPaymentId: overrides.payment === undefined ? "pay_1" : overrides.payment,
    externalCheckoutId: overrides.checkout === undefined ? "co_1" : overrides.checkout,
    reference: overrides.reference === undefined ? "ORDER-1" : overrides.reference,
    externalRefundId: null,
    refundStatus: null,
    amountMinor: overrides.amount === undefined ? 1000 : overrides.amount,
    currency: overrides.currency === undefined ? "PHP" : overrides.currency,
    livemode: overrides.livemode ?? false,
    occurredAt: new Date("2026-09-02T00:00:00Z"),
    receivedAt: new Date("2026-09-02T00:00:01Z"),
  };
  let fact: PaymentsSettlementFactSnapshot | null = null;
  return {
    async findProviderEventById(id) {
      return id === event.id ? event : null;
    },
    async findCheckoutAttempt(provider, checkout) {
      if (provider !== "fakepay" || checkout !== "co_1") return null;
      return {
        id: "attempt-1",
        sourceReference: "src-1",
        commercialReference: "ORDER-1",
        provider: "fakepay",
        requestFingerprint: "rf",
        amountMinor: 1000,
        currency: "PHP",
        payerSnapshot: {},
        itemsSnapshot: [],
        status: "PENDING",
        externalCheckoutId: "co_1",
        checkoutUrl: "https://example.test",
        failureCode: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },
    async claim(input) {
      const created = fact === null;
      if (!fact) {
        fact = Object.freeze({
          settlementFactId: input.id,
          ...input,
          createdAt: new Date("2026-09-02T00:00:02Z"),
        });
      }
      return { created, record: fact };
    },
  };
}

const mismatchCases: ReadonlyArray<readonly [RepoOverrides, string]> = [
  [{ livemode: true }, "MODE_MISMATCH"],
  [{ checkout: "wrong" }, "CHECKOUT_MISMATCH"],
  [{ reference: "ORDER-X" }, "REFERENCE_MISMATCH"],
  [{ amount: 999 }, "AMOUNT_MISMATCH"],
  [{ currency: "USD" }, "CURRENCY_MISMATCH"],
  [{ payment: null }, "PAYMENT_REFERENCE_MISSING"],
  [{ type: "payment.failed" }, "UNSUPPORTED_EVENT"],
];

describe("Payments settlement fact", () => {
  it("creates then reuses a reconciled settlement fact", async () => {
    const capability = createPaymentsSettlementFactCapability(repo());
    const first = await capability.reconcile({
      providerEventRecordId: "event-row",
      expectedLivemode: false,
    });
    const second = await capability.reconcile({
      providerEventRecordId: "event-row",
      expectedLivemode: false,
    });
    expect(first.status).toBe("SETTLED");
    expect(second.status).toBe("SETTLED");
  });

  it.each(mismatchCases)("rejects mismatch %s", async (overrides, code) => {
    const result = await createPaymentsSettlementFactCapability(repo(overrides)).reconcile({
      providerEventRecordId: "event-row",
      expectedLivemode: false,
    });
    expect(result).toEqual({ status: "REJECTED", code });
  });
});
