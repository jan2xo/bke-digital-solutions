import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  dispatch: vi.fn(),
  enabled: vi.fn(),
  process: vi.fn(),
  readBody: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("next/server", () => ({
  after: mocks.after,
  NextResponse: { json: (value: unknown, init?: ResponseInit) => Response.json(value, init) },
}));
vi.mock("@/apps/web/http/request", () => ({
  readLimitedBody: mocks.readBody,
  clientIp: () => "127.0.0.1",
}));
vi.mock("@/apps/web/http/rate-limit", () => ({ rateLimit: mocks.rateLimit }));
vi.mock("@/apps/web/payments/webhook-processing", () => ({
  processPaymentWebhookWithOutcome: mocks.process,
}));
vi.mock("@/apps/web/email/purchase-confirmation", () => ({
  purchaseConfirmationEmailEnabled: mocks.enabled,
}));
vi.mock("@/apps/web/email", () => ({ dispatchVerifiedPurchaseConfirmation: mocks.dispatch }));

import { POST } from "@/app/api/webhooks/payments/route";

function request() {
  return new Request("https://example.invalid/api/webhooks/payments", { method: "POST" });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.enabled.mockReturnValue(true);
  mocks.readBody.mockResolvedValue(Buffer.from("{}"));
  mocks.rateLimit.mockResolvedValue({ allowed: true });
  mocks.process.mockResolvedValue({ result: { processed: true }, verifiedPaid: true, paidOrderId: "order-paid-1" });
  mocks.dispatch.mockResolvedValue({ selected: 1, sent: 1 });
});

describe("verified-paid webhook post-response invoice outbox kick", () => {
  it("sends a successful ACK before any mail provider operation and bounds background work", async () => {
    const scheduled: Array<() => Promise<unknown>> = [];
    mocks.after.mockImplementation((callback: () => Promise<unknown>) => { scheduled.push(callback); });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: true });
    expect(mocks.after).toHaveBeenCalledOnce();
    expect(mocks.dispatch).not.toHaveBeenCalled();
    await scheduled[0]();
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch).toHaveBeenCalledWith("order-paid-1");
  });

  it("does not dispatch a different queued email when the verified order identity is missing", async () => {
    mocks.process.mockResolvedValueOnce({ result: { processed: true }, verifiedPaid: true, paidOrderId: undefined });
    expect((await POST(request())).status).toBe(200);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("does not wake mail for duplicate, unsupported, refunded or failed payment events", async () => {
    for (const event of [
      { result: { duplicate: true }, verifiedPaid: false },
      { result: { ignored: true }, verifiedPaid: false },
      { result: { processed: true }, verifiedPaid: false },
    ]) {
      mocks.process.mockResolvedValueOnce(event);
      expect((await POST(request())).status).toBe(200);
    }
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("keeps both background scheduling and transport failures outside the webhook ACK", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      mocks.after.mockImplementationOnce(() => { throw new Error("UNSUPPORTED_WAIT_UNTIL"); });
      expect((await POST(request())).status).toBe(200);
      expect(warning).toHaveBeenCalledWith("PURCHASE_CONFIRMATION_OUTBOX_KICK_UNAVAILABLE");

      let scheduled: (() => Promise<void>) | undefined;
      mocks.after.mockImplementationOnce((callback: () => Promise<void>) => { scheduled = callback; });
      mocks.dispatch.mockRejectedValueOnce(new Error("EMAIL_UNAVAILABLE"));
      expect((await POST(request())).status).toBe(200);
      await scheduled!();
      expect(warning).toHaveBeenCalledWith("PURCHASE_CONFIRMATION_OUTBOX_KICK_FAILED");
    } finally {
      warning.mockRestore();
    }
  });

  it("never initiates an email send until the explicit activation gate is enabled", async () => {
    mocks.enabled.mockReturnValue(false);
    expect((await POST(request())).status).toBe(200);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("never schedules mail on missing webhook authorization or rate limiting", async () => {
    mocks.process.mockRejectedValueOnce(new Error("PAYMENT_SIGNATURE_INVALID"));
    const rejection = await POST(request());
    expect(rejection.status).toBe(400);
    mocks.rateLimit.mockResolvedValueOnce({ allowed: false });
    expect((await POST(request())).status).toBe(429);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});
