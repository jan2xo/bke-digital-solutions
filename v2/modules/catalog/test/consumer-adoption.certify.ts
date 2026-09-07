import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_RELEASE =
  "https://github.com/jan2xo/bke-libraries-typescript/releases/download/catalog-v0.3.0/bke-catalog-0.3.0.tgz";
const EXPECTED_VERSION = "0.3.0";
const EXPECTED_SHA256 =
  "806fa9702322cc716b3f749821bf26a7c74407df07681254ac9335580694f5aa";
const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const [
  moduleSource,
  packageSource,
  lockSource,
  nextConfigSource,
  catalogWorkflowSource,
  standaloneWorkflowSource,
  webRuntimeSource,
  standaloneBootstrapSource,
] = await Promise.all([
  readFile(new URL("../module.ts", import.meta.url), "utf8"),
  readFile(new URL("../../../../package.json", import.meta.url), "utf8"),
  readFile(new URL("../../../../package-lock.json", import.meta.url), "utf8"),
  readFile(new URL("../../../../next.config.ts", import.meta.url), "utf8"),
  readFile(new URL("../../../../.github/workflows/v2-catalog.yml", import.meta.url), "utf8"),
  readFile(new URL("../../../../.github/workflows/v2-standalone.yml", import.meta.url), "utf8"),
  readFile(new URL("../../../apps/web/runtime.ts", import.meta.url), "utf8"),
  readFile(new URL("../../../apps/standalone/bootstrap.ts", import.meta.url), "utf8"),
]);

if (!moduleSource.includes("CapabilityModule") || !moduleSource.includes('"../../contracts/capability"')) {
  throw new Error("Catalog host adapter must retain the Digital Solutions CapabilityModule contract.");
}

for (const marker of [
  "@bke/catalog/contracts/",
  "CATALOG_LICENSING_VERSION_FACTS_CAPABILITY_ID",
  "@bke/catalog/logic/",
  "@bke/catalog/logic/licensing-version-facts",
  "createCatalogLicensingVersionFactsCapability",
  "@bke/catalog/prisma/repositories/",
  "@bke/catalog/prisma/repositories/postgres-licensing-version-facts-repository",
  "createPostgresCatalogLicensingVersionFactsRepository",
  "@bke/catalog/prisma/repositories/legacy-schema-licensing-version-facts-repository",
  "createLegacySchemaCatalogLicensingVersionFactsRepository",
  'licensingVersionFactsStorage?: "native" | "legacy-product-schema"',
  "licensingVersionFacts",
  "@bke/catalog/module.manifest",
]) {
  if (!moduleSource.includes(marker)) {
    throw new Error(`Catalog host adapter is missing standalone package surface: ${marker}`);
  }
}

for (const marker of [
  '"./contracts/',
  '"./logic/',
  '"./prisma/repositories/',
  '"./module.manifest"',
]) {
  if (moduleSource.includes(marker)) {
    throw new Error(`Catalog host adapter consumes retired staging implementation: ${marker}`);
  }
}

if (!webRuntimeSource.includes('licensingVersionFactsStorage: "legacy-product-schema"')) {
  throw new Error("V2 web convergence host must use the Catalog-owned legacy Product schema adapter.");
}
if (standaloneBootstrapSource.includes("legacy-product-schema")) {
  throw new Error("Fresh standalone V2 host must keep native Catalog persistence.");
}

const packageJson = JSON.parse(packageSource) as { dependencies?: Record<string, string> };
if (packageJson.dependencies?.["@bke/catalog"] !== EXPECTED_RELEASE) {
  throw new Error(
    `Digital Solutions package.json does not pin the certified Catalog artifact: ${packageJson.dependencies?.["@bke/catalog"]}`,
  );
}

const packageLock = JSON.parse(lockSource) as {
  packages?: Record<string, { dependencies?: Record<string, string>; version?: string; resolved?: string; integrity?: string }>;
};
if (packageLock.packages?.[""]?.dependencies?.["@bke/catalog"] !== EXPECTED_RELEASE) {
  throw new Error("Digital Solutions package-lock root does not pin the certified Catalog artifact.");
}
const lockedCatalog = packageLock.packages?.["node_modules/@bke/catalog"];
if (
  lockedCatalog?.version !== EXPECTED_VERSION ||
  lockedCatalog.resolved !== EXPECTED_RELEASE ||
  !lockedCatalog.integrity
) {
  throw new Error(
    `Digital Solutions Catalog lock entry is incomplete or drifted: ${JSON.stringify(lockedCatalog)}`,
  );
}

if (!nextConfigSource.includes('"@bke/catalog"')) {
  throw new Error("Next.js must explicitly transpile the source-native @bke/catalog package.");
}

for (const marker of [
  EXPECTED_RELEASE,
  EXPECTED_SHA256,
  "node_modules/@bke/catalog/prisma/schema.prisma",
  "node_modules/@bke/catalog/migrations",
  "Certify Catalog consumer adoption and staging retirement",
]) {
  if (!catalogWorkflowSource.includes(marker)) {
    throw new Error(`Catalog CI is missing package-backed retirement guardrail: ${marker}`);
  }
}

for (const forbiddenWorkflowMarker of [
  "v2/modules/catalog/test/extraction.certify.ts",
  "v2/modules/catalog/test/catalog.test.ts",
  "v2/modules/catalog/test/postgres.certify.ts",
  "v2/modules/catalog/vitest.config.ts",
  "v2/modules/catalog/prisma/schema.prisma",
  "v2/modules/catalog/prisma/migrations",
]) {
  if (catalogWorkflowSource.includes(forbiddenWorkflowMarker)) {
    throw new Error(`Catalog CI still depends on retired staging: ${forbiddenWorkflowMarker}`);
  }
}

for (const marker of [
  "node_modules/@bke/catalog/migrations",
  "Apply Catalog migrations to fresh PostgreSQL",
]) {
  if (!standaloneWorkflowSource.includes(marker)) {
    throw new Error(`Standalone certification is not package-backed for Catalog: ${marker}`);
  }
}

const moduleEntries = readdirSync(moduleRoot).sort();
if (JSON.stringify(moduleEntries) !== JSON.stringify(["module.ts", "test"])) {
  throw new Error(`Catalog staging root must remain retired: ${JSON.stringify(moduleEntries)}`);
}
const testEntries = readdirSync(resolve(moduleRoot, "test")).sort();
if (JSON.stringify(testEntries) !== JSON.stringify(["consumer-adoption.certify.ts"])) {
  throw new Error(`Catalog staging tests must remain retired: ${JSON.stringify(testEntries)}`);
}

console.log(
  `Catalog package-backed consumer adoption and staging retirement GREEN; version=${EXPECTED_VERSION} integrity=${lockedCatalog.integrity}`,
);
