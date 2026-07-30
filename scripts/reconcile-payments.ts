import "dotenv/config";
import { reconcilePayment } from "../lib/reconciliation";

const orderIds = process.argv.slice(2);
if (!orderIds.length) throw new Error("Usage: npm run payments:reconcile -- <order-id> [...]");
let failed = false;
for (const orderId of orderIds) {
  const result = await reconcilePayment(orderId);
  console.info(JSON.stringify(result));
  if (!result.matched) failed = true;
}
if (failed) process.exitCode = 2;
