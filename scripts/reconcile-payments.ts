import "dotenv/config";
import { createPaymentsReconciliationCapability } from "@bke/payments/logic/reconciliation";
import { createPayMongoPaymentsAdapter } from "@bke/payments/providers/paymongo/paymongo-adapter";
import { createPostgresPaymentsReconciliationRepository } from "@bke/payments/prisma/repositories/postgres-reconciliation-repository";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing reconciliation environment: ${name}`);
  return value;
}

if ((process.env.PAYMENT_PROVIDER?.trim() || "paymongo") !== "paymongo") {
  throw new Error("PAYMENT_RECONCILIATION_REQUIRES_PAYMONGO");
}

const reconciliation = createPaymentsReconciliationCapability(
  createPostgresPaymentsReconciliationRepository(required("DATABASE_URL")),
  createPayMongoPaymentsAdapter({
    secretKey: required("PAYMONGO_SECRET_KEY"),
    webhookSecret: required("PAYMONGO_WEBHOOK_SECRET"),
    livemode: process.env.PAYMONGO_LIVEMODE === "true",
    paymentMethodTypes: ["qrph"],
    successUrl: () => "http://localhost/reconciliation-only",
    cancelUrl: () => "http://localhost/reconciliation-only",
  }),
);

const orderIds = process.argv.slice(2);
if (!orderIds.length) throw new Error("Usage: npm run payments:reconcile -- <order-id> [...]");

let failed = false;
for (const orderId of orderIds) {
  const result = await reconciliation.run({
    commercialReference: orderId,
    runById: "cli:payments-reconcile",
  });
  console.info(JSON.stringify(result));
  if (result.status !== "RECONCILED" || result.value.classification !== "MATCHED") {
    failed = true;
  }
}
if (failed) process.exitCode = 2;
