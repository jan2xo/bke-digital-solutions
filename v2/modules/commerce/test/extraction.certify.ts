import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extractableRoots = ["contracts", "logic", "prisma/repositories"] as const;

function filesUnder(root: string): string[] {
  const absolute = resolve(moduleRoot, root);
  if (!existsSync(absolute)) throw new Error(`Missing Commerce extraction root: ${root}`);
  const files: string[] = [];
  const visit = (path: string) => {
    for (const name of readdirSync(path)) {
      const child = join(path, name);
      if (statSync(child).isDirectory()) visit(child);
      else if (child.endsWith(".ts")) files.push(child);
    }
  };
  visit(absolute);
  return files;
}

const reusableFiles = [
  ...extractableRoots.flatMap(filesUnder),
  resolve(moduleRoot, "module.manifest.ts"),
];
const forbiddenMarkers = [
  'from "@bke/',
  "from '@bke/",
  'from "@/',
  "from '@/",
  'from "next/',
  "from 'next/",
  'from "server-only"',
  "from 'server-only'",
  "/v2/platform/",
  "/v2/apps/",
  "../../contracts/capability",
];
for (const file of reusableFiles) {
  const source = readFileSync(file, "utf8");
  for (const marker of forbiddenMarkers) {
    if (source.includes(marker)) {
      throw new Error(`Commerce reusable surface leaks host/cross-library dependency: ${relative(moduleRoot, file)} -> ${marker}`);
    }
  }
}

const manifestSource = readFileSync(resolve(moduleRoot, "module.manifest.ts"), "utf8");
if (!manifestSource.includes("needs: []")) {
  throw new Error("Commerce package manifest must remain host-independent with needs: [].");
}
if (!manifestSource.includes("CommerceModuleManifest")) {
  throw new Error("Commerce package manifest must use the package-local manifest contract.");
}

const migrationRoot = resolve(moduleRoot, "prisma/migrations");
const migrations = readdirSync(migrationRoot)
  .filter((name) => statSync(join(migrationRoot, name)).isDirectory())
  .sort();
const expectedMigrations = [
  "0001_commerce_purchase_plan_baseline",
  "0002_commerce_offers_redemptions",
  "0003_commerce_orders_invoices",
];
if (JSON.stringify(migrations) !== JSON.stringify(expectedMigrations)) {
  throw new Error(`Commerce migration set drifted: ${JSON.stringify(migrations)}`);
}

const schema = readFileSync(resolve(moduleRoot, "prisma/schema.prisma"), "utf8");
const models = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((match) => match[1]).sort();
const expectedModels = [
  "DiscountOffer",
  "Invoice",
  "InvoiceLine",
  "OfferRedemption",
  "Order",
  "OrderItem",
  "Price",
  "PurchasePlan",
].sort();
if (JSON.stringify(models) !== JSON.stringify(expectedModels)) {
  throw new Error(`Commerce schema contains foreign/unexpected models: ${JSON.stringify(models)}`);
}

const hostModule = readFileSync(resolve(moduleRoot, "module.ts"), "utf8");
for (const marker of ["@bke/accounts/", "@bke/legal/", "@bke/payments/", "@bke/entitlements/"]) {
  if (!hostModule.includes(marker)) throw new Error(`Commerce host adapter is missing expected composition dependency: ${marker}`);
}

console.log(`Commerce extraction boundary GREEN: reusableFiles=${reusableFiles.length} models=${models.length} migrations=${migrations.length}`);
