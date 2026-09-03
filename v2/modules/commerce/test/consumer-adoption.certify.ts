import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_RELEASE =
  "https://github.com/jan2xo/bke-libraries-typescript/releases/download/commerce-v0.1.0/bke-commerce-0.1.0.tgz";
const EXPECTED_VERSION = "0.1.0";
const EXPECTED_SHA256 =
  "9cdb41e3607c87768a44c71d1eca690ddb23b5ff175c2eef1f4ebb2b9907bc14";
const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const [moduleSource, packageSource, lockSource, nextConfigSource, commerceWorkflowSource, standaloneWorkflowSource] =
  await Promise.all([
    readFile(new URL("../module.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../../package.json", import.meta.url), "utf8"),
    readFile(new URL("../../../../package-lock.json", import.meta.url), "utf8"),
    readFile(new URL("../../../../next.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../../.github/workflows/v2-commerce.yml", import.meta.url), "utf8"),
    readFile(new URL("../../../../.github/workflows/v2-standalone.yml", import.meta.url), "utf8"),
  ]);

if (!moduleSource.includes("CapabilityModule") || !moduleSource.includes('"../../contracts/capability"')) {
  throw new Error("Commerce host adapter must retain the Digital Solutions CapabilityModule contract.");
}

for (const marker of [
  "@bke/commerce/contracts/",
  "@bke/commerce/logic/",
  "@bke/commerce/prisma/repositories/",
  "@bke/commerce/module.manifest",
]) {
  if (!moduleSource.includes(marker)) {
    throw new Error(`Commerce host adapter is missing standalone package surface: ${marker}`);
  }
}

for (const marker of [
  '"./contracts/',
  '"./logic/',
  '"./prisma/repositories/',
  '"./module.manifest"',
]) {
  if (moduleSource.includes(marker)) {
    throw new Error(`Commerce host adapter consumes retired staging implementation: ${marker}`);
  }
}

const packageJson = JSON.parse(packageSource) as { dependencies?: Record<string, string> };
if (packageJson.dependencies?.["@bke/commerce"] !== EXPECTED_RELEASE) {
  throw new Error(
    `Digital Solutions package.json does not pin the certified Commerce artifact: ${packageJson.dependencies?.["@bke/commerce"]}`,
  );
}

const packageLock = JSON.parse(lockSource) as {
  packages?: Record<string, { dependencies?: Record<string, string>; version?: string; resolved?: string; integrity?: string }>;
};
if (packageLock.packages?.[""]?.dependencies?.["@bke/commerce"] !== EXPECTED_RELEASE) {
  throw new Error("Digital Solutions package-lock root does not pin the certified Commerce artifact.");
}

const lockedCommerce = packageLock.packages?.["node_modules/@bke/commerce"];
if (
  lockedCommerce?.version !== EXPECTED_VERSION ||
  lockedCommerce.resolved !== EXPECTED_RELEASE ||
  !lockedCommerce.integrity
) {
  throw new Error(
    `Digital Solutions Commerce lock entry is incomplete or drifted: ${JSON.stringify(lockedCommerce)}`,
  );
}

if (!nextConfigSource.includes('"@bke/commerce"')) {
  throw new Error("Next.js must explicitly transpile the source-native @bke/commerce package.");
}

for (const marker of [
  EXPECTED_RELEASE,
  EXPECTED_SHA256,
  "node_modules/@bke/commerce/prisma/schema.prisma",
  "node_modules/@bke/commerce/migrations",
  "Certify Commerce consumer adoption and staging retirement",
]) {
  if (!commerceWorkflowSource.includes(marker)) {
    throw new Error(`Commerce CI is missing package-backed retirement guardrail: ${marker}`);
  }
}

for (const forbiddenWorkflowMarker of [
  "v2/modules/commerce/test/extraction.certify.ts",
  "v2/modules/commerce/test/purchase-plan-pricing.test.ts",
  "v2/modules/commerce/test/purchase-plan-lookup.test.ts",
  "v2/modules/commerce/test/offer-redemption.test.ts",
  "v2/modules/commerce/test/order-invoice-creation.test.ts",
  "v2/modules/commerce/test/checkout-orchestration.test.ts",
  "v2/modules/commerce/test/settlement-reaction.test.ts",
  "v2/modules/commerce/test/module-composition.test.ts",
]) {
  if (commerceWorkflowSource.includes(forbiddenWorkflowMarker)) {
    throw new Error(`Commerce CI still depends on retired staging: ${forbiddenWorkflowMarker}`);
  }
}

for (const marker of [
  "node_modules/@bke/commerce/migrations",
  "Apply Commerce migrations to fresh PostgreSQL",
]) {
  if (!standaloneWorkflowSource.includes(marker)) {
    throw new Error(`Standalone certification is not package-backed for Commerce: ${marker}`);
  }
}

const moduleEntries = readdirSync(moduleRoot).sort();
if (JSON.stringify(moduleEntries) !== JSON.stringify(["module.ts", "test"])) {
  throw new Error(`Commerce staging root must remain retired: ${JSON.stringify(moduleEntries)}`);
}
const testEntries = readdirSync(resolve(moduleRoot, "test")).sort();
if (JSON.stringify(testEntries) !== JSON.stringify(["consumer-adoption.certify.ts"])) {
  throw new Error(`Commerce staging tests must remain retired: ${JSON.stringify(testEntries)}`);
}

console.log(
  `Commerce package-backed consumer adoption and staging retirement GREEN; version=${EXPECTED_VERSION} integrity=${lockedCommerce.integrity}`,
);
