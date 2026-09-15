import "server-only";

import { db } from "@/v2/platform/host/db";
import { createCheckout as createLegacyCheckout } from "@/tests/support/legacy-checkout-fixture";

/**
 * @deprecated Test-only compatibility surface for pre-V2 integration suites.
 * Production routes use the released Commerce/Payments capabilities through the V2 web runtime.
 *
 * The old fixture still creates the host PaymentAttempt directly. Mirror that completed fixture
 * result into the released Payments owner persistence shape so integration tests exercise the same
 * settlement facts as production without moving checkout policy back into the host.
 */
export async function createCheckout(...args: Parameters<typeof createLegacyCheckout>) {
  const result = await createLegacyCheckout(...args);
  if ("complimentary" in result) return result;

  const order = await db.order.findUniqueOrThrow({
    where: { id: result.orderId },
    include: { attempts: { orderBy: { createdAt: "desc" }, take: 1 }, items: true },
  });
  const attempt = order.attempts[0];
  if (!attempt?.externalCheckoutId || !attempt.checkoutUrl) return result;

  const sourceReference = `test-fixture:${attempt.id}`;
  await db.$executeRaw`
    INSERT INTO "PaymentCheckoutAttempt" (
      "id", "sourceReference", "commercialReference", "provider", "requestFingerprint",
      "amountMinor", "currency", "payerSnapshot", "itemsSnapshot", "status",
      "externalCheckoutId", "checkoutUrl", "createdAt", "updatedAt"
    ) VALUES (
      ${attempt.id}, ${sourceReference}, ${order.id}, ${attempt.provider}, ${attempt.idempotencyKey},
      ${order.totalMinor}, ${order.currency}, ${JSON.stringify(order.billingSnapshot)}::jsonb,
      ${JSON.stringify(order.items.map((item) => ({
        orderItemId: item.id,
        productId: item.productId,
        editionId: item.editionId,
        quantity: item.quantity,
        amountMinor: item.totalMinor,
      })))}::jsonb,
      'PENDING'::"PaymentCheckoutAttemptStatus", ${attempt.externalCheckoutId}, ${attempt.checkoutUrl},
      ${attempt.createdAt}, ${attempt.updatedAt}
    )
    ON CONFLICT ("sourceReference") DO UPDATE SET
      "commercialReference" = EXCLUDED."commercialReference",
      "provider" = EXCLUDED."provider",
      "requestFingerprint" = EXCLUDED."requestFingerprint",
      "amountMinor" = EXCLUDED."amountMinor",
      "currency" = EXCLUDED."currency",
      "payerSnapshot" = EXCLUDED."payerSnapshot",
      "itemsSnapshot" = EXCLUDED."itemsSnapshot",
      "status" = EXCLUDED."status",
      "externalCheckoutId" = EXCLUDED."externalCheckoutId",
      "checkoutUrl" = EXCLUDED."checkoutUrl",
      "updatedAt" = EXCLUDED."updatedAt"
  `;

  return result;
}
