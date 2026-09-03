import { readFile } from "node:fs/promises";

const EXPECTED_RELEASE =
  "https://github.com/jan2xo/bke-libraries-typescript/releases/download/catalog-v0.1.0/bke-catalog-0.1.0.tgz";
const EXPECTED_VERSION = "0.1.0";
const EXPECTED_SHA256 =
  "765f266a70c16ef6a722744cb51adf290294b430f8bfb35e81ae7252f675c1d5";

const [moduleSource, packageSource, lockSource, nextConfigSource, catalogWorkflowSource, standaloneWorkflowSource] =
  await Promise.all([
    readFile(new URL("../module.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../../package.json", import.meta.url), "utf8"),
    readFile(new URL("../../../../package-lock.json", import.meta.url), "utf8"),
    readFile(new URL("../../../../next.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../../.github/workflows/v2-catalog.yml", import.meta.url), "utf8"),
    readFile(new URL("../../../../.github/workflows/v2-standalone.yml", import.meta.url), "utf8"),
  ]);

if (!moduleSource.includes("CapabilityModule") || !moduleSource.includes('"../../contracts/capability"')) {
  throw new Error("Catalog host adapter must retain the Digital Solutions CapabilityModule contract.");
}

for (const marker of [
  "@bke/catalog/contracts/",
  "@bke/catalog/logic/",
  "@bke/catalog/prisma/repositories/",
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
    throw new Error(`Catalog host adapter still prefers staging implementation: ${marker}`);
  }
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
  "Certify Catalog consumer adoption",
]) {
  if (!catalogWorkflowSource.includes(marker)) {
    throw new Error(`Catalog CI is missing package-backed adoption guardrail: ${marker}`);
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

console.log(
  `Catalog package-backed consumer adoption GREEN; version=${EXPECTED_VERSION} integrity=${lockedCatalog.integrity}`,
);
