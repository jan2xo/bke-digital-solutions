import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_RELEASE =
  "https://github.com/jan2xo/bke-libraries-typescript/releases/download/entitlements-v0.2.1/bke-entitlements-0.2.1.tgz";
const EXPECTED_VERSION = "0.2.1";
const EXPECTED_SHA256 =
  "45c749558d07704a47f25ee08a3bff69d48541e0f1166b456605398c796e2a05";
const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const [
  moduleSource,
  packageSource,
  lockSource,
  nextConfigSource,
  entitlementsWorkflowSource,
  migrationCompositorSource,
] = await Promise.all([
  readFile(new URL("../module.ts", import.meta.url), "utf8"),
  readFile(new URL("../../../package.json", import.meta.url), "utf8"),
  readFile(new URL("../../../package-lock.json", import.meta.url), "utf8"),
  readFile(new URL("../../../next.config.ts", import.meta.url), "utf8"),
  readFile(
    new URL("../../../.github/workflows/v2-entitlements.yml", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../../../platform/persistence/migration-compositor.mjs", import.meta.url),
    "utf8",
  ),
]);

if (
  !moduleSource.includes("CapabilityModule") ||
  !moduleSource.includes('"../../contracts/capability"')
) {
  throw new Error(
    "Entitlements host adapter must retain the Digital Solutions CapabilityModule contract.",
  );
}

const requiredPackageSurfaces = [
  "@bke/entitlements/contracts/",
  "@bke/entitlements/logic/",
  "@bke/entitlements/prisma/repositories/",
  "@bke/entitlements/module.manifest",
];
for (const marker of requiredPackageSurfaces) {
  if (!moduleSource.includes(marker)) {
    throw new Error(`Entitlements host adapter is missing standalone package surface: ${marker}`);
  }
}

for (const marker of [
  "ENTITLEMENTS_DURABLE_RIGHT_GRANT_CAPABILITY_ID",
  "ENTITLEMENTS_DURABLE_RIGHT_REVOCATION_CAPABILITY_ID",
  "createEntitlementsDurableRightRevocationCapability",
  "createPostgresEntitlementsDurableRightRevocationRepository",
]) {
  if (!moduleSource.includes(marker)) {
    throw new Error(`Entitlements host module is missing 0.2.0 capability wiring: ${marker}`);
  }
}

const forbiddenStagingSpecifiers = [
  '"./contracts/',
  '"./logic/',
  '"./prisma/repositories/',
  '"./module.manifest"',
];
for (const marker of forbiddenStagingSpecifiers) {
  if (moduleSource.includes(marker)) {
    throw new Error(`Entitlements host adapter still consumes staging implementation: ${marker}`);
  }
}

const forbiddenStagingPaths = [
  "contracts",
  "docs",
  "logic",
  "module.manifest.ts",
  "prisma.config.ts",
  "prisma",
  "test/durable-right-grant.test.ts",
  "test/durable-right-grant.postgres.certify.ts",
  "test/extraction.certify.ts",
  "test/persistence-isolation.certify.ts",
  "test/module-composition.test.ts",
];
for (const path of forbiddenStagingPaths) {
  if (existsSync(resolve(moduleRoot, path))) {
    throw new Error(
      `Entitlements staging path must be retired after library adoption: ${path}`,
    );
  }
}

const packageJson = JSON.parse(packageSource) as {
  dependencies?: Record<string, string>;
};
if (packageJson.dependencies?.["@bke/entitlements"] !== EXPECTED_RELEASE) {
  throw new Error(
    `Digital Solutions package.json does not pin the certified Entitlements artifact: ${packageJson.dependencies?.["@bke/entitlements"]}`,
  );
}

const packageLock = JSON.parse(lockSource) as {
  packages?: Record<
    string,
    {
      dependencies?: Record<string, string>;
      version?: string;
      resolved?: string;
      integrity?: string;
    }
  >;
};
if (
  packageLock.packages?.[""]?.dependencies?.["@bke/entitlements"] !== EXPECTED_RELEASE
) {
  throw new Error(
    "Digital Solutions package-lock root does not pin the certified Entitlements artifact.",
  );
}

const lockedEntitlements = packageLock.packages?.["node_modules/@bke/entitlements"];
if (
  lockedEntitlements?.version !== EXPECTED_VERSION ||
  lockedEntitlements.resolved !== EXPECTED_RELEASE ||
  !lockedEntitlements.integrity
) {
  throw new Error(
    `Digital Solutions Entitlements lock entry is incomplete or drifted: ${JSON.stringify(lockedEntitlements)}`,
  );
}

if (!nextConfigSource.includes('"@bke/entitlements"')) {
  throw new Error(
    "Next.js must explicitly transpile the source-native @bke/entitlements package.",
  );
}

const requiredWorkflowMarkers = [
  EXPECTED_RELEASE,
  EXPECTED_SHA256,
  "node_modules/@bke/entitlements/prisma/schema.prisma",
  "node_modules/@bke/entitlements/migrations",
  "Certify Entitlements consumer adoption and staging retirement",
];
for (const marker of requiredWorkflowMarkers) {
  if (!entitlementsWorkflowSource.includes(marker)) {
    throw new Error(`Entitlements CI is missing package-backed retirement guardrail: ${marker}`);
  }
}

if (!migrationCompositorSource.includes("configuredMigrationsRoot")) {
  throw new Error(
    "The migration compositor must support module-owned external migration roots.",
  );
}

console.log(
  `Entitlements package-backed consumer adoption and staging retirement GREEN; version=${EXPECTED_VERSION} integrity=${lockedEntitlements.integrity}`,
);
