import "dotenv/config";
import {
  LICENSING_GRACE_PRODUCTS,
} from "@bke/licensing/contracts/grace-period.contract";
import {
  createLicensingGracePeriodCapability,
  parseLicensingGraceBoolean,
  parseLicensingGraceProduct,
} from "@bke/licensing/logic/grace-period";
import { createPostgresLicensingGracePeriodStore } from "@bke/licensing/prisma/repositories/postgres-grace-period-store";
import { createLicensingGraceAuditEffect } from "../v2/modules/licensing/grace-audit";

function usage(): never {
  throw new Error("Usage: grace:status | grace:set <airstack|renderdock> <true|false>");
}

function requiredDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required.");
  return value;
}

async function main(): Promise<void> {
  const grace = createLicensingGracePeriodCapability({
    store: createPostgresLicensingGracePeriodStore(requiredDatabaseUrl()),
    mutationEffect: createLicensingGraceAuditEffect(),
  });
  const [operation, product, value, ...extra] = process.argv.slice(2);
  if (operation === "status" && !product && !value && extra.length === 0) {
    const statuses = await grace.readStatuses();
    for (const key of LICENSING_GRACE_PRODUCTS) console.log(`${key}: ${statuses[key]}`);
    return;
  }
  if (operation !== "set" || !product || !value || extra.length > 0) usage();
  const key = parseLicensingGraceProduct(product);
  const enabled = parseLicensingGraceBoolean(value);
  const oldValue = await grace.setState({
    productKey: key,
    graceEnabled: enabled,
    operationSource: "VPS_CLI",
  });
  console.log(`${key} grace: ${oldValue} -> ${enabled}`);
}

main().catch(() => {
  console.error("Grace operation failed.");
  process.exitCode = 1;
});
