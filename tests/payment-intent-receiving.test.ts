import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPayMongoPaymentsAdapter } from "@bke/payments/providers/paymongo/paymongo-adapter";
import { createPayMongoPaymentIntentAdapter } from "@bke/payments/providers/paymongo/paymongo-payment-intent-adapter";
import type { PaymentsCheckoutAttemptRecord } from "@bke/payments/logic/checkout-attempt-repository";
import type { PaymentsPaymentIntentAttemptRecord } from "@bke/payments/logic/payment-intent-repository";
import type { PaymentsProviderEventRecord, PaymentsProviderEventRepository } from "@bke/payments/logic/provider-event-repository";
import type { PaymentsSettlementFactClaim, PaymentsSettlementFactRepository } from "@bke/payments/logic/settlement-fact-repository";
import type { PaymentsSettlementFactSnapshot } from "@bke/payments/contracts/settlement-fact.contract";
import { createPaymentsProviderEventIngestionCapability } from "@bke/payments/logic/provider-event-ingestion";
import { createPaymentsSettlementFactCapability } from "@bke/payments/logic/settlement-fact";
import { ignoredNonFinancialPaymentEventCode } from "@/apps/web/payments/webhook-event-policy";
import { PAYMENTS_PAYMENT_INTENT_CAPABILITY_ID, type PaymentsPaymentIntentCapability } from "@bke/payments/contracts/payment-intent.contract";
import { createPaymentsModule } from "../modules/payments/module";
import { COMMERCE_PAYMENT_INTENT_CHECKOUT_CAPABILITY_ID, type CommercePaymentIntentCheckoutCapability } from "@bke/commerce/contracts/payment-intent-checkout.contract";
import { createCommerceModule } from "../modules/commerce/module";
import type { CapabilityResolver } from "../contracts/capability";

const secret = "synthetic-paymongo-webhook-secret";
const occurredAt = new Date("2026-11-06T00:00:00.000Z");
const timestamp = Math.floor(occurredAt.getTime() / 1000);
const provider = createPayMongoPaymentsAdapter({
  secretKey: "sk_test_synthetic",
  webhookSecret: secret,
  livemode: false,
  now: () => occurredAt,
  successUrl: () => "https://example.test/checkout/success",
  cancelUrl: () => "https://example.test/checkout/cancel",
});

function signedEvent(options: {
  readonly eventId?: string;
  readonly type?: string;
  readonly externalPaymentId?: string;
  readonly paymentIntentId?: string;
  readonly externalCheckoutId?: string;
  readonly reference?: string;
  readonly amountMinor?: number;
  readonly currency?: string;
  readonly livemode?: boolean;
}) {
  const type = options.type ?? "payment.paid";
  const isIntent = type.startsWith("payment_intent.");
  const resource = isIntent
    ? {
        id: options.paymentIntentId ?? "pi_synthetic_1",
        type: "payment_intent",
        attributes: {},
      }
    : {
        id: options.externalCheckoutId ?? options.externalPaymentId ?? "pay_synthetic_1",
        type: options.externalCheckoutId ? "checkout_session" : "payment",
        attributes: {
          ...(options.paymentIntentId ? { payment_intent_id: options.paymentIntentId } : {}),
          ...(options.externalCheckoutId ? { checkout_session_id: options.externalCheckoutId, payment_id: options.externalPaymentId ?? "pay_synthetic_1" } : {}),
          ...(options.reference === undefined ? { reference_number: "order-1" } : { reference_number: options.reference }),
          amount: options.amountMinor ?? 1000,
          currency: options.currency ?? "PHP",
        },
      };
  const body = Buffer.from(JSON.stringify({
    data: {
      id: options.eventId ?? "evt_synthetic_1",
      attributes: {
        type,
        livemode: options.livemode ?? false,
        created_at: timestamp,
        data: resource,
      },
    },
  }));
  const signature = createHmac("sha256", secret).update(String(timestamp) + "." + body.toString("utf8")).digest("hex");
  return {
    rawBody: body,
    headers: { "paymongo-signature": "t=" + timestamp + ",te=" + signature },
  };
}

function paymentIntentAttempt(): PaymentsPaymentIntentAttemptRecord {
  return Object.freeze({
    id: "pi-attempt-1",
    sourceReference: "checkout-source-1",
    commercialReference: "order-1",
    provider: "paymongo",
    requestFingerprint: "fingerprint",
    amountMinor: 1000,
    currency: "PHP",
    paymentMethodAllowed: Object.freeze(["qrph"]),
    livemode: false,
    idempotencyKey: "bke_pi_synthetic",
    idempotencyExpiresAt: new Date("2026-11-07T00:00:00.000Z"),
    createDispatchedAt: occurredAt,
    createLeaseUntil: null,
    createLeaseToken: null,
    statusObservedAt: occurredAt,
    paymentIntentId: "pi_synthetic_1",
    status: "SUCCEEDED",
    failureCode: null,
    createdAt: occurredAt,
    updatedAt: occurredAt,
  });
}

function checkoutAttempt(): PaymentsCheckoutAttemptRecord {
  return Object.freeze({
    id: "checkout-attempt-1",
    sourceReference: "hosted-source-1",
    commercialReference: "order-1",
    provider: "paymongo",
    requestFingerprint: "hosted-fingerprint",
    amountMinor: 1000,
    currency: "PHP",
    payerSnapshot: {},
    itemsSnapshot: [],
    status: "PENDING",
    externalCheckoutId: "cs_synthetic_1",
    checkoutUrl: "https://example.test/pay",
    failureCode: null,
    createdAt: occurredAt,
    updatedAt: occurredAt,
  });
}

function eventRepository(): {
  readonly repository: PaymentsProviderEventRepository;
  readonly records: Map<string, PaymentsProviderEventRecord>;
} {
  const records = new Map<string, PaymentsProviderEventRecord>();
  const repository: PaymentsProviderEventRepository = Object.freeze<PaymentsProviderEventRepository>({
    async claim(input) {
      const key = input.provider + ":" + input.eventId;
      const existing = records.get(key);
      if (existing) return { created: false, record: existing };
      const record: PaymentsProviderEventRecord = Object.freeze({
        ...input,
        receivedAt: occurredAt,
      });
      records.set(key, record);
      return { created: true, record };
    },
  });
  return { repository, records };
}

function settlementRepository(records: Map<string, PaymentsProviderEventRecord>, options: {
  readonly intentAttempt?: PaymentsPaymentIntentAttemptRecord | null;
  readonly hostedAttempt?: PaymentsCheckoutAttemptRecord | null;
} = {}) {
  const facts: PaymentsSettlementFactSnapshot[] = [];
  let claimCount = 0;
  const repository: PaymentsSettlementFactRepository = Object.freeze<PaymentsSettlementFactRepository>({
    async findProviderEventById(id: string) {
      return [...records.values()].find((record) => record.id === id) ?? null;
    },
    async findCheckoutAttempt(providerName: string, externalCheckoutId: string) {
      const attempt = options.hostedAttempt ?? null;
      return attempt && attempt.provider === providerName && attempt.externalCheckoutId === externalCheckoutId
        ? attempt
        : null;
    },
    async findPaymentIntentAttempt(providerName: string, paymentIntentId: string) {
      const attempt = options.intentAttempt === undefined ? paymentIntentAttempt() : options.intentAttempt;
      return attempt && attempt.provider === providerName && attempt.paymentIntentId === paymentIntentId
        ? attempt
        : null;
    },
    async claim(input: PaymentsSettlementFactClaim) {
      claimCount += 1;
      const existing = facts.find((fact) =>
        fact.providerEventRecordId === input.providerEventRecordId ||
        (fact.provider === input.provider && fact.externalPaymentId === input.externalPaymentId) ||
        (input.paymentIntentId !== null && fact.provider === input.provider && fact.paymentIntentId === input.paymentIntentId),
      );
      if (existing) return { created: false, record: existing };
      const record: PaymentsSettlementFactSnapshot = Object.freeze({
        settlementFactId: input.id,
        providerEventRecordId: input.providerEventRecordId,
        checkoutAttemptId: input.checkoutAttemptId,
        provider: input.provider,
        eventId: input.eventId,
        externalPaymentId: input.externalPaymentId,
        ...(input.externalCheckoutId === null ? {} : { externalCheckoutId: input.externalCheckoutId }),
        ...(input.paymentIntentId === null ? {} : { paymentIntentId: input.paymentIntentId }),
        commercialReference: input.commercialReference,
        amountMinor: input.amountMinor,
        currency: input.currency,
        livemode: input.livemode,
        settledAt: input.settledAt,
        createdAt: occurredAt,
      });
      facts.push(record);
      return { created: true, record };
    },
  });
  return { repository, facts, claimCount: () => claimCount };
}

async function ingest(options: Parameters<typeof signedEvent>[0] = {}) {
  const signed = signedEvent(options);
  const events = eventRepository();
  const capability = createPaymentsProviderEventIngestionCapability(events.repository, provider);
  const result = await capability.ingest({
    rawBody: new Uint8Array(signed.rawBody),
    headers: signed.headers,
  });
  expect(result.status).toBe("VERIFIED");
  if (result.status !== "VERIFIED") throw new Error("test fixture event did not verify");
  return { event: result.value, records: events.records, result };
}

describe("Payment Intent webhook receiving", () => {
  it("verifies and retains the Payment Intent identity on signed payment.paid, then binds the financial fact to that attempt", async () => {
    const ingested = await ingest({ paymentIntentId: "pi_synthetic_1" });
    expect(ingested.event).toMatchObject({
      type: "payment.paid",
      externalPaymentId: "pay_synthetic_1",
      paymentIntentId: "pi_synthetic_1",
      reference: "order-1",
      amountMinor: 1000,
      currency: "PHP",
      livemode: false,
    });

    const persistence = settlementRepository(ingested.records);
    const capability = createPaymentsSettlementFactCapability(persistence.repository);
    const result = await capability.reconcile({
      providerEventRecordId: ingested.event.providerEventRecordId,
      expectedLivemode: false,
    });
    expect(result).toMatchObject({
      status: "SETTLED",
      disposition: "CREATED",
      value: {
        checkoutAttemptId: "pi-attempt-1",
        commercialReference: "order-1",
        externalPaymentId: "pay_synthetic_1",
        paymentIntentId: "pi_synthetic_1",
        amountMinor: 1000,
        currency: "PHP",
        livemode: false,
      },
    });
    if (result.status === "SETTLED") expect(result.value.externalCheckoutId).toBeUndefined();
    expect(persistence.facts).toHaveLength(1);
  });

  it("deduplicates repeated paid evidence by provider payment and Payment Intent identity", async () => {
    const first = await ingest({ eventId: "evt_paid_1", paymentIntentId: "pi_synthetic_1" });
    const second = await ingest({ eventId: "evt_paid_2", paymentIntentId: "pi_synthetic_1" });
    const allRecords = new Map([...first.records, ...second.records]);
    const persistence = settlementRepository(allRecords);
    const capability = createPaymentsSettlementFactCapability(persistence.repository);

    const one = await capability.reconcile({ providerEventRecordId: first.event.providerEventRecordId, expectedLivemode: false });
    const two = await capability.reconcile({ providerEventRecordId: second.event.providerEventRecordId, expectedLivemode: false });

    expect(one).toMatchObject({ status: "SETTLED", disposition: "CREATED" });
    expect(two).toMatchObject({ status: "SETTLED", disposition: "EXISTING" });
    expect(persistence.facts).toHaveLength(1);
    expect(persistence.claimCount()).toBe(2);
  });

  it.each([
    [{ reference: "another-order" }, "REFERENCE_MISMATCH"],
    [{ amountMinor: 999 }, "AMOUNT_MISMATCH"],
    [{ currency: "USD" }, "CURRENCY_MISMATCH"],
  ] as const)("rejects mismatched verified Payment Intent payment facts", async (overrides, code) => {
    const ingested = await ingest({ ...overrides, paymentIntentId: "pi_synthetic_1" });
    const persistence = settlementRepository(ingested.records);
    const result = await createPaymentsSettlementFactCapability(persistence.repository).reconcile({
      providerEventRecordId: ingested.event.providerEventRecordId,
      expectedLivemode: false,
    });
    expect(result).toEqual({ status: "REJECTED", code });
    expect(persistence.facts).toHaveLength(0);
  });

  it("rejects a Payment Intent identity that is not bound to a stored attempt", async () => {
    const ingested = await ingest({ paymentIntentId: "pi_synthetic_1" });
    const persistence = settlementRepository(ingested.records, { intentAttempt: null });
    const result = await createPaymentsSettlementFactCapability(persistence.repository).reconcile({
      providerEventRecordId: ingested.event.providerEventRecordId,
      expectedLivemode: false,
    });
    expect(result).toEqual({ status: "REJECTED", code: "PAYMENT_INTENT_MISMATCH" });
    expect(persistence.facts).toHaveLength(0);
  });

  it("rejects mode mismatch and never treats payment_intent.succeeded as settlement evidence", async () => {
    const wrongMode = await ingest({ eventId: "evt_wrong_mode", paymentIntentId: "pi_synthetic_1", livemode: true });
    const modeResult = await createPaymentsSettlementFactCapability(
      settlementRepository(wrongMode.records).repository,
    ).reconcile({
      providerEventRecordId: wrongMode.event.providerEventRecordId,
      expectedLivemode: false,
    });
    expect(modeResult).toEqual({ status: "REJECTED", code: "MODE_MISMATCH" });

    const lifecycle = await ingest({ eventId: "evt_intent_succeeded", type: "payment_intent.succeeded" });
    expect(lifecycle.event.paymentIntentId).toBe("pi_synthetic_1");
    expect(ignoredNonFinancialPaymentEventCode(lifecycle.event.type)).toBe("PAYMENT_INTENT_LIFECYCLE_IGNORED");
    const lifecycleResult = await createPaymentsSettlementFactCapability(
      settlementRepository(lifecycle.records).repository,
    ).reconcile({
      providerEventRecordId: lifecycle.event.providerEventRecordId,
      expectedLivemode: false,
    });
    expect(lifecycleResult).toEqual({ status: "REJECTED", code: "UNSUPPORTED_EVENT" });
  });

  it("retains the existing hosted-checkout settlement identity path", async () => {
    const ingested = await ingest({
      eventId: "evt_hosted_paid",
      externalCheckoutId: "cs_synthetic_1",
      paymentIntentId: undefined,
    });
    const persistence = settlementRepository(ingested.records, { hostedAttempt: checkoutAttempt() });
    const result = await createPaymentsSettlementFactCapability(persistence.repository).reconcile({
      providerEventRecordId: ingested.event.providerEventRecordId,
      expectedLivemode: false,
    });
    expect(result).toMatchObject({
      status: "SETTLED",
      value: {
        checkoutAttemptId: "checkout-attempt-1",
        externalCheckoutId: "cs_synthetic_1",
        externalPaymentId: "pay_synthetic_1",
      },
    });
    if (result.status === "SETTLED") expect(result.value.paymentIntentId).toBeUndefined();
  });

  it("requires matching public and secret key modes through the published PayMongo Payment Intent adapter", () => {
    expect(() => createPayMongoPaymentIntentAdapter({
      secretKey: "sk_test_synthetic",
      publicKey: "pk_live_synthetic",
      livemode: false,
      paymentMethodTypes: ["qrph"],
    })).toThrow("PAYMENT_PROVIDER_UNSAFE_CONFIGURATION");

    const configured = createPayMongoPaymentIntentAdapter({
      secretKey: "sk_test_synthetic",
      publicKey: "pk_test_synthetic",
      livemode: false,
      paymentMethodTypes: ["qrph"],
    });
    expect(configured.name).toBe("paymongo");
    expect(configured.livemode).toBe(false);
  });

  it("exposes a disabled Payment Intent capability without constructing its persistence repository when no real provider is configured", async () => {
    const provider = {
      name: "mock",
      async createCheckout() { throw new Error("checkout must not be called"); },
    };
    const paymentsModule = createPaymentsModule({
      connectionString: "postgresql://fixture:fixture@127.0.0.1:1/fixture",
      provider,
      eventVerifier: { name: "mock", async verifyAndParse() { throw new Error("webhook must not be called"); } },
      refundProvider: { name: "mock", async createRefund() { throw new Error("refund must not be called"); } },
      reconciliationProvider: { name: "mock", async retrievePayment() { throw new Error("reconciliation must not be called"); } },
    });
    const safeResolver: CapabilityResolver = {
      has() { return false; },
      get<T>() { throw new Error("disabled fixture must not resolve capabilities"); },
    };
    const registrations = await paymentsModule.start(safeResolver);
    const registration = registrations.find((item) => item.id === PAYMENTS_PAYMENT_INTENT_CAPABILITY_ID);
    expect(registration).toBeDefined();
    const capability = registration?.value as PaymentsPaymentIntentCapability;

    await expect(capability.create({
      sourceReference: "checkout-source-1",
      commercialReference: "order-1",
      amountMinor: 1000,
      currency: "PHP",
      livemode: false,
      paymentMethodAllowed: ["qrph"],
    })).resolves.toEqual({ status: "FAILED", code: "CREATION_DISABLED" });
  });

  it("keeps Commerce Payment Intent checkout immediately disabled without trusted live provider policy", async () => {
    let paymentCalls = 0;
    let authorizationCalls = 0;
    const inert = {
      async authorize() { authorizationCalls += 1; return { status: "AUTHORIZED" as const }; },
      async check() { return { status: "ACCEPTED" as const }; },
      async create() { paymentCalls += 1; return { status: "FAILED" as const, code: "CREATION_DISABLED" as const }; },
      async reconcile() { return { status: "FAILED" as const, code: "PERSISTENCE_UNAVAILABLE" as const }; },
      async grant() { return { status: "FAILED" as const, code: "PERSISTENCE_UNAVAILABLE" as const }; },
    };
    const resolver = { get: () => inert } as unknown as CapabilityResolver;
    const commerceModule = createCommerceModule({
      connectionString: "postgresql://fixture:fixture@127.0.0.1:1/fixture",
      claimUnits: { async issue() { throw new Error("claim issuance must not run"); } },
    });
    const registrations = await commerceModule.start(resolver);
    const registration = registrations.find((item) => item.id === COMMERCE_PAYMENT_INTENT_CHECKOUT_CAPABILITY_ID);
    expect(registration).toBeDefined();
    const capability = registration?.value as CommercePaymentIntentCheckoutCapability;

    await expect(capability.start({} as never)).resolves.toEqual({
      status: "FAILED",
      code: "PAYMENT_INTENT_CREATION_DISABLED",
    });
    expect(paymentCalls).toBe(0);
    expect(authorizationCalls).toBe(0);
  });

  it("routes lifecycle and unknown events to acknowledgement without a financial or refund action", () => {
    expect(ignoredNonFinancialPaymentEventCode("payment_intent.succeeded")).toBe("PAYMENT_INTENT_LIFECYCLE_IGNORED");
    expect(ignoredNonFinancialPaymentEventCode("payment_intent.awaiting_payment_method")).toBe("PAYMENT_INTENT_LIFECYCLE_IGNORED");
    expect(ignoredNonFinancialPaymentEventCode("qrph.expired")).toBe("PAYMENT_INTENT_LIFECYCLE_IGNORED");
    expect(ignoredNonFinancialPaymentEventCode("unknown")).toBe("PAYMENT_EVENT_UNSUPPORTED");
    expect(ignoredNonFinancialPaymentEventCode("payment.refunded")).toBeNull();
  });
});
