import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_RELEASE =
  "https://github.com/jan2xo/bke-libraries-typescript/releases/download/entitlements-v0.1.0/bke-entitlements-0.1.0.tgz";
const EXPECTED_VERSION = "0.1.0";
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
  readFile(new URL("../../../../package.json", import.meta.url), "utf8"),
  readFile(new URL("../../../../package-lock.json", import.meta.url), "utf8"),
  readFile(new URL("../../../../next.config.ts", import.meta.url), "utf8"),
  readFile(
    new URL("../../../../.github/workflows/v2-entitlements.yml", import.meta.url),
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

const requiredStagingPaths = [
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
for (const path of requiredStagingPaths) {
  if (!existsSync(resolve(moduleRoot, path))) {
    throw new Error(
      `Entitlements staging source was deleted before package-backed consumer certification: ${path}`,
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

if (
  !entitlementsWorkflowSource.includes("node_modules/@bke/entitlements/prisma/schema.prisma") ||
  !entitlementsWorkflowSource.includes("node_modules/@bke/entitlements/migrations")
) {
  throw new Error(
    "Entitlements CI must validate and compose persistence from the installed @bke/entitlements package.",
  );
}

if (!migrationCompositorSource.includes("configuredMigrationsRoot")) {
  throw new Error(
    "The migration compositor must support module-owned external migration roots.",
  );
}

console.log(
  `Entitlements standalone consumer adoption GREEN; staging retained for certified comparison; version=${EXPECTED_VERSION} integrity=${lockedEntitlements.integrity}`,
);
