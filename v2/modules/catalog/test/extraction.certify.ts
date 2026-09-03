import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { catalogModuleManifest } from "../module.manifest";

const root = "v2/modules/catalog";
const reusableRoots = [
  `${root}/contracts`,
  `${root}/logic`,
  `${root}/prisma/repositories`,
];
const reusableFiles = [`${root}/module.manifest.ts`];

function filesUnder(path: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(path)) {
    const child = join(path, name);
    if (statSync(child).isDirectory()) found.push(...filesUnder(child));
    else if ([".ts", ".tsx", ".js", ".mjs"].includes(extname(child))) found.push(child);
  }
  return found;
}

const files = [...reusableRoots.flatMap(filesUnder), ...reusableFiles];
const forbiddenMarkers = [
  `${"@"}/bke/`,
  `${"@"}/`,
  "next/",
  '"server-only"',
  "v2/platform",
  "v2/apps",
  "../../contracts/capability",
  "../contracts/capability",
  "generated/prisma",
  "/modules/commerce/",
  "/modules/payments/",
  "/modules/entitlements/",
  "/modules/licensing/",
  "/modules/distribution/",
];

for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const marker of forbiddenMarkers) {
    assert.equal(text.includes(marker), false, `${file} contains forbidden reusable-surface marker: ${marker}`);
  }
}

assert.equal(catalogModuleManifest.moduleId, "catalog");
assert.deepEqual(catalogModuleManifest.needs, []);
assert.deepEqual(catalogModuleManifest.provides, [
  "bke.catalog.lookup.v1",
  "bke.catalog.management.v1",
]);

const schema = readFileSync(`${root}/prisma/schema.prisma`, "utf8");
const models = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((match) => match[1]).sort();
assert.deepEqual(models, ["CatalogEdition", "CatalogProduct"]);
assert.equal(schema.includes("CatalogEdition[]"), true);
assert.equal(schema.includes("CatalogProduct @relation"), true);

const migrationsRoot = `${root}/prisma/migrations`;
const migrations = readdirSync(migrationsRoot)
  .filter((name) => statSync(join(migrationsRoot, name)).isDirectory())
  .sort();
assert.deepEqual(migrations, ["0001_catalog_product_edition"]);
assert.equal(existsSync(`${migrationsRoot}/0001_catalog_product_edition/migration.sql`), true);

const hostAdapter = readFileSync(`${root}/module.ts`, "utf8");
assert.equal(hostAdapter.includes('from "../../contracts/capability"'), true);
assert.equal(hostAdapter.includes("createPostgresCatalogRepository"), true);

console.log(
  `Catalog extraction certification GREEN: reusableFiles=${files.length} models=${models.join(",")} migrations=${migrations.join(",")}`,
);
