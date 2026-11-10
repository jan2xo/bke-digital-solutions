import { describe, expect, it } from "vitest";
import {
  matchesProvenSettledCompanion,
  type CompanionPaidEvent,
  type ProvenSettledPayment,
} from "@/apps/web/payments/companion-paid-event";

const validEvent: CompanionPaidEvent = Object.freeze({
  type: "payment.paid",
  rawType: "payment.paid",
  externalPaymentId: "pay_valid",
  amountMinor: 10000,
  currency: "PHP",
  livemode: true,
});

const fact: ProvenSettledPayment = Object.freeze({
  paymentId: "local_payment",
  orderId: "local_order",
  externalPaymentId: "pay_valid",
  amountMinor: 10000,
  currency: "PHP",
  livemode: true,
});

describe("signed direct PayMongo companion payment policy", () => {
  it("acknowledges only an already-settled matching payment event", () => {
    expect(matchesProvenSettledCompanion(validEvent, fact)).toBe(true);
    expect(matchesProvenSettledCompanion({ ...validEvent, currency: "php" }, fact)).toBe(true);
  });

  it("never accepts a direct notification before a matching checkout settlement exists", () => {
    expect(matchesProvenSettledCompanion(validEvent, null)).toBe(false);
  });

  it.each([
    [{ type: "payment.refunded" }, "wrong normalized type"],
    [{ rawType: "checkout_session.payment.paid" }, "checkout event"],
    [{ rawType: "payment.failed" }, "failed payment"],
    [{ externalPaymentId: "pay_unknown" }, "wrong external payment"],
    [{ externalCheckoutId: "cs_conflict" }, "checkout ID present"],
    [{ reference: "order_conflict" }, "commercial reference present"],
    [{ amountMinor: 9999 }, "wrong amount"],
    [{ amountMinor: 10001 }, "extra amount"],
    [{ amountMinor: 0 }, "zero amount"],
    [{ amountMinor: NaN }, "invalid amount"],
    [{ currency: "USD" }, "wrong currency"],
    [{ livemode: false }, "test/live mode cross"],
  ] as Array<[Partial<CompanionPaidEvent>, string]>)(
    "fails closed on %s (%s)",
    (change) => {
      expect(matchesProvenSettledCompanion({ ...validEvent, ...change }, fact)).toBe(false);
    },
  );

  it.each([
    [{ externalPaymentId: "pay_other" }, "different settlement payment"],
    [{ amountMinor: 9999 }, "changed recorded amount"],
    [{ currency: "USD" }, "changed settlement currency"],
    [{ livemode: false }, "wrong settlement mode"],
    [{ paymentId: "" }, "missing local payment"],
    [{ orderId: "" }, "missing local order"],
  ] as Array<[Partial<ProvenSettledPayment>, string]>)(
    "rejects an invalid settlement record (%s)",
    (change) => {
      expect(matchesProvenSettledCompanion(validEvent, { ...fact, ...change })).toBe(false);
    },
  );
});
