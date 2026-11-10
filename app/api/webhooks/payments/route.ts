import { after, NextResponse } from "next/server";
import { readLimitedBody, clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { processPaymentWebhook } from "@/apps/web/payments/webhook-processing";
import { purchaseConfirmationEmailEnabled } from "@/apps/web/email/purchase-confirmation";
import { dispatchEmailOutbox } from "@/apps/web/email";
import { PaymentLifecycleError, safePaymentError } from "@bke/payments/logic/payment-errors";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!(await rateLimit(`webhook:${clientIp(request)}`, 240, 60)).allowed) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }
    const raw = await readLimitedBody(request);
    const result = await processPaymentWebhook(raw, request.headers);

    // A successful, verified paid settlement already committed its FINAL invoice
    // and deduplicated outbox row. The webhook never sends through a provider.
    // Wake the outbox *after* responding to PayMongo (or another verified
    // provider); the protected cron retries any missed or rejected deliveries.
    if ("processed" in result && result.processed &&
        "paid" in result && result.paid && purchaseConfirmationEmailEnabled()) {
      after(async () => {
        try {
          // Bounded post-response work: do not hold 20 provider requests in one
          // Worker invocation. The durable cron owns the remaining queue.
          await dispatchEmailOutbox(3);
        } catch {
          // Payment has already settled. Email failures never undo fulfillment
          // or turn the provider webhook response into a retryable failure.
          console.warn("PURCHASE_CONFIRMATION_OUTBOX_KICK_FAILED");
        }
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "PAYLOAD_TOO_LARGE") {
      return NextResponse.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
    }
    const code = safePaymentError(error);
    const status = code === "PAYMENT_EVENT_REPLAY_CONFLICT"
      ? 409 : error instanceof PaymentLifecycleError && error.retryable ? 503 : 400;
    return NextResponse.json({ error: code }, { status });
  }
}
