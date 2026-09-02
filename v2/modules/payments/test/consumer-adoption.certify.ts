import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_RELEASE =
  "https://github.com/jan2xo/bke-libraries-typescript/releases/download/payments-v0.1.0/bke-payments-0.1.0.tgz";
const EXPECTED_VERSION = "0.1.0";
const EXPECTED_SHA256 =
  "d28c5fd37360e717416c4827c4aba48bf960685f324565b7ae0ca948eb318f41";
const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const [
  moduleSource,
  packageSource,
  lockSource,
  nextConfigSource,
  paymentsWorkflowSource,
  migrationCompositorSource,
] = await Promise.all([
  readFile(new URL("../module.ts", import.meta.url), "utf8"),
  readFile(new URL("../../../../package.json", import.meta.url), "utf8"),
  readFile(new URL("../../../../package-lock.json", import.meta.url), "utf8"),
  readFile(new URL("../../../../next.config.ts", import.meta.url), "utf8"),
  readFile(
    new URL("../../../../.github/workflows/v2-payments.yml", import.meta.url),
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
    "Payments host adapter must retain the Digital Solutions CapabilityModule contract.",
  );
}

const requiredPackageSurfaces = [
  "@bke/payments/contracts/",
  "@bke/payments/logic/",
  "@bke/payments/prisma/repositories/",
  "@bke/payments/module.manifest",
];
for (const marker of requiredPackageSurfaces) {
  if (!moduleSource.includes(marker)) {
    throw new Error(`Payments host adapter is missing standalone package surface: ${marker}`);
  }
}

const forbiddenStagingSpecifiers = [
  '"./contracts/',
  '"./logic/',
  '"./prisma/repositories/',
  '"./providers/',
  '"./module.manifest"',
];
for (const marker of forbiddenStagingSpecifiers) {
  if (moduleSource.includes(marker)) {
    throw new Error(`Payments host adapter still consumes staging implementation: ${marker}`);
  }
}

const forbiddenStagingPaths = [
  "contracts",
  "docs",
  "logic",
  "module.manifest.ts",
  "prisma.config.ts",
  "prisma",
  "providers",
  "test/checkout-attempt.test.ts",
  "test/checkout-attempt.postgres.certify.ts",
  "test/provider-event-ingestion.test.ts",
  "test/provider-event-ingestion.postgres.certify.ts",
  "test/settlement-fact.test.ts",
  "test/settlement-fact.postgres.certify.ts",
  "test/refund-initiation.test.ts",
  "test/refund-initiation.postgres.certify.ts",
  "test/paymongo-adapter.test.ts",
  "test/extraction.certify.ts",
  "test/module-composition.test.ts",
];
for (const path of forbiddenStagingPaths) {
  if (existsSync(resolve(moduleRoot, path))) {
    throw new Error(
      `Payments staging path must be retired after library adoption: ${path}`,
    );
  }
}

const packageJson = JSON.parse(packageSource) as {
  dependencies?: Record<string, string>;
};
if (packageJson.dependencies?.["@bke/payments"] !== EXPECTED_RELEASE) {
  throw new Error(
    `Digital Solutions package.json does not pin the certified Payments artifact: ${packageJson.dependencies?.["@bke/payments"]}`,
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
if (packageLock.packages?.[""]?.dependencies?.["@bke/payments"] !== EXPECTED_RELEASE) {
  throw new Error(
    "Digital Solutions package-lock root does not pin the certified Payments artifact.",
  );
}

const lockedPayments = packageLock.packages?.["node_modules/@bke/payments"];
if (
  lockedPayments?.version !== EXPECTED_VERSION ||
  lockedPayments.resolved !== EXPECTED_RELEASE ||
  !lockedPayments.integrity
) {
  throw new Error(
    `Digital Solutions Payments lock entry is incomplete or drifted: ${JSON.stringify(lockedPayments)}`,
  );
}

if (!nextConfigSource.includes('"@bke/payments"')) {
  throw new Error(
    "Next.js must explicitly transpile the source-native @bke/payments package.",
  );
}

const requiredWorkflowMarkers = [
  EXPECTED_RELEASE,
  EXPECTED_SHA256,
  "node_modules/@bke/payments/prisma/schema.prisma",
  "node_modules/@bke/payments/migrations",
  "Certify Payments consumer adoption and staging retirement",
];
for (const marker of requiredWorkflowMarkers) {
  if (!paymentsWorkflowSource.includes(marker)) {
    throw new Error(`Payments CI is missing package-backed retirement guardrail: ${marker}`);
  }
}

const forbiddenWorkflowMarkers = [
  "v2/modules/payments/test/extraction.certify.ts",
  "v2/modules/payments/test/paymongo-adapter.test.ts",
  "v2/modules/payments/test/module-composition.test.ts",
  "Regression-test Payments staging capabilities",
];
for (const marker of forbiddenWorkflowMarkers) {
  if (paymentsWorkflowSource.includes(marker)) {
    throw new Error(`Payments CI still depends on retired staging: ${marker}`);
  }
}

if (!migrationCompositorSource.includes("configuredMigrationsRoot")) {
  throw new Error(
    "The migration compositor must support module-owned external migration roots.",
  );
}

console.log(
  `Payments package-backed consumer adoption and staging retirement GREEN; version=${EXPECTED_VERSION} integrity=${lockedPayments.integrity}`,
);
