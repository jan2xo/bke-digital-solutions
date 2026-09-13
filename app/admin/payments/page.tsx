import {
  PAYMENTS_RECONCILIATION_CAPABILITY_ID,
  type PaymentsReconciliationCapability,
} from "@bke/payments/contracts/reconciliation.contract";
import { AdminTable } from "@/components/admin-table";
import { ReconcileButton, WebhookAction } from "@/components/admin-payment-actions";
import { db } from "@/v2/platform/host/db";
import { getV2WebApplication } from "@/v2/apps/web/runtime";

async function listRecentReconciliations() {
  const application = await getV2WebApplication();
  const reconciliation = application.get<PaymentsReconciliationCapability>(
    PAYMENTS_RECONCILIATION_CAPABILITY_ID,
  );
  const result = await reconciliation.listRecent({ limit: 100 });
  if (result.status !== "LISTED") {
    throw new Error("PAYMENT_RECONCILIATION_UNAVAILABLE");
  }
  return result.values;
}

export default async function Payments() {
  const [attempts, webhooks, reconciliations, refunds] = await Promise.all([
    db.paymentAttempt.findMany({
      include: { order: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.webhookEvent.findMany({ orderBy: { receivedAt: "desc" }, take: 100 }),
    listRecentReconciliations(),
    db.refundOperation.findMany({
      include: { order: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  const reconciliationOrderIds = [...new Set(reconciliations.map((x) => x.commercialReference))];
  const reconciliationOrders = reconciliationOrderIds.length
    ? await db.order.findMany({
        where: { id: { in: reconciliationOrderIds } },
        select: { id: true, number: true },
      })
    : [];
  const orderNumbers = new Map(reconciliationOrders.map((order) => [order.id, order.number]));

  return (
    <section className="shell space-y-8 py-10">
      <div>
        <h1 className="text-4xl font-black">Payment operations</h1>
        <p className="mt-2 text-muted">
          Safe PayMongo lifecycle evidence. Raw provider payloads and secrets are never displayed.
        </p>
      </div>

      <section>
        <h2 className="mb-3 text-2xl font-black">Attempts</h2>
        <AdminTable
          headers={["Order", "Provider", "Status", "Created", "Action"]}
          rows={attempts.map((x) => [
            x.order.number,
            x.provider,
            x.status,
            x.createdAt.toLocaleString(),
            <ReconcileButton key={x.id} orderId={x.orderId} />,
          ])}
        />
      </section>

      <section>
        <h2 className="mb-3 text-2xl font-black">Webhook deliveries</h2>
        <AdminTable
          headers={["Event", "Status", "Error", "Attempts", "Resolution", "Action"]}
          rows={webhooks.map((x) => [
            x.eventType,
            x.status,
            x.lastErrorCode ?? "—",
            String(x.processingAttempts),
            x.resolutionStatus,
            x.status === "FAILED" && x.normalizedData ? (
              <WebhookAction key={x.id} id={x.id} action="RETRY" />
            ) : x.resolutionStatus === "OPEN" ? (
              <WebhookAction key={x.id} id={x.id} action="ACKNOWLEDGE" />
            ) : (
              "—"
            ),
          ])}
        />
      </section>

      <section>
        <h2 className="mb-3 text-2xl font-black">Reconciliation evidence</h2>
        <AdminTable
          headers={["Order", "Classification", "Local", "Provider", "Status", "Created"]}
          rows={reconciliations.map((x) => [
            orderNumbers.get(x.commercialReference) ?? x.commercialReference,
            x.classification,
            x.localStatus,
            x.providerStatus ?? "—",
            x.state,
            x.createdAt.toLocaleString(),
          ])}
        />
      </section>

      <section>
        <h2 className="mb-3 text-2xl font-black">Refund operations</h2>
        <AdminTable
          headers={["Order", "Amount", "Reason", "Status", "Created"]}
          rows={refunds.map((x) => [
            x.order.number,
            `${x.currency} ${(x.amountMinor / 100).toLocaleString()}`,
            x.reasonCode,
            x.status,
            x.createdAt.toLocaleString(),
          ])}
        />
      </section>
    </section>
  );
}
