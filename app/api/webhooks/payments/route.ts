import { after, NextResponse } from "next/server";
import { readLimitedBody, clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { processPaymentWebhookWithOutcome } from "@/apps/web/payments/webhook-processing";
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
    const { result, verifiedPaid } = await processPaymentWebhookWithOutcome(raw, request.headers);

    // A verified paid settlement already committed its FINAL invoice and
    // deduplicated outbox row. This route never calls the provider directly.
    // The protected cron retries any missed or rejected deliveries.
    if (verifiedPaid && purchaseConfirmationEmailEnabled()) {
      try {
        after(async () => {
          try {
            // Bounded post-response work. Cron owns the remaining queue.
            await dispatchEmailOutbox(3);
          } catch {
            console.warn("PURCHASE_CONFIRMATION_OUTBOX_KICK_FAILED");
          }
        });
      } catch {
        // Unsupported background scheduling must not turn a confirmed payment
        // into a false webhook failure: the durable cron will recover the mail.
        console.warn("PURCHASE_CONFIRMATION_OUTBOX_KICK_UNAVAILABLE");
      }
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
