import "dotenv/config";
import {
  GRACE_PRODUCTS,
  parseGraceBoolean,
  parseGraceProduct,
  readGraceStatuses,
  setGraceState,
} from "../lib/grace-period";

function usage(): never {
  throw new Error("Usage: grace:status | grace:set <airstack|renderdock> <true|false>");
}

async function main(): Promise<void> {
  const [operation, product, value, ...extra] = process.argv.slice(2);
  if (operation === "status" && !product && !value && extra.length === 0) {
    const statuses = await readGraceStatuses();
    for (const key of GRACE_PRODUCTS) console.log(`${key}: ${statuses[key]}`);
    return;
  }
  if (operation !== "set" || !product || !value || extra.length > 0) usage();
  const key = parseGraceProduct(product);
  const enabled = parseGraceBoolean(value);
  const oldValue = await setGraceState(key, enabled);
  console.log(`${key} grace: ${oldValue} -> ${enabled}`);
}

main().catch(() => {
  console.error("Grace operation failed.");
  process.exitCode = 1;
});
