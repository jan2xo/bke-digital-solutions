import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

const EXPECTED_RELEASE =
  "https://github.com/jan2xo/bke-libraries-typescript/releases/download/accounts-v0.2.0/bke-accounts-0.2.0.tgz";
const EXPECTED_VERSION = "0.2.0";

const [
  moduleSource,
  commerceModuleSource,
  packageSource,
  lockSource,
  nextConfigSource,
  accountsWorkflowSource,
  migrationCompositorSource,
] = await Promise.all([
  readFile(new URL("../module.ts", import.meta.url), "utf8"),
  readFile(new URL("../../commerce/module.ts", import.meta.url), "utf8"),
  readFile(new URL("../../../../package.json", import.meta.url), "utf8"),
  readFile(new URL("../../../../package-lock.json", import.meta.url), "utf8"),
  readFile(new URL("../../../../next.config.ts", import.meta.url), "utf8"),
  readFile(
    new URL("../../../../.github/workflows/v2-accounts.yml", import.meta.url),
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
    "Accounts host adapter must retain the Digital Solutions CapabilityModule contract.",
  );
}

const requiredPackageSurfaces = [
  "@bke/accounts/contracts/",
  "@bke/accounts/contracts/purchase-access.contract",
  "@bke/accounts/logic/",
  "@bke/accounts/logic/purchase-access",
  "@bke/accounts/providers/",
  "@bke/accounts/prisma/repositories/",
  "@bke/accounts/module.manifest",
];
for (const marker of requiredPackageSurfaces) {
  if (!moduleSource.includes(marker)) {
    throw new Error(`Accounts host adapter is missing standalone package surface: ${marker}`);
  }
}

if (
  !commerceModuleSource.includes("ACCOUNTS_PURCHASE_ACCESS_CAPABILITY_ID") ||
  !commerceModuleSource.includes("AccountsPurchaseAccessCapability") ||
  commerceModuleSource.includes("ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID")
) {
  throw new Error(
    "Commerce host checkout authorization must consume Accounts purchase-access instead of generic account-access.",
  );
}

const forbiddenStagingSpecifiers = [
  '"./contracts/',
  '"./logic/',
  '"./providers/',
  '"./prisma/repositories/',
  '"./module.manifest"',
];
for (const marker of forbiddenStagingSpecifiers) {
  if (moduleSource.includes(marker)) {
    throw new Error(`Accounts host adapter still consumes staging implementation: ${marker}`);
  }
}

const forbiddenStagingPaths = [
  new URL("../contracts", import.meta.url),
  new URL("../logic", import.meta.url),
  new URL("../providers", import.meta.url),
  new URL("../prisma", import.meta.url),
  new URL("../docs", import.meta.url),
  new URL("../module.manifest.ts", import.meta.url),
  new URL("../prisma.config.ts", import.meta.url),
  new URL("./module-composition.test.ts", import.meta.url),
  new URL("./extraction.certify.ts", import.meta.url),
  new URL("./persistence-isolation.certify.ts", import.meta.url),
];
for (const path of forbiddenStagingPaths) {
  if (existsSync(path)) {
    throw new Error(`Accounts staging path still exists after retirement: ${path.pathname}`);
  }
}

const packageJson = JSON.parse(packageSource) as {
  dependencies?: Record<string, string>;
};
if (packageJson.dependencies?.["@bke/accounts"] !== EXPECTED_RELEASE) {
  throw new Error(
    `Digital Solutions package.json does not pin the certified Accounts artifact: ${packageJson.dependencies?.["@bke/accounts"]}`,
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
  packageLock.packages?.[""]?.dependencies?.["@bke/accounts"] !==
  EXPECTED_RELEASE
) {
  throw new Error(
    "Digital Solutions package-lock root does not pin the certified Accounts artifact.",
  );
}

const lockedAccounts = packageLock.packages?.["node_modules/@bke/accounts"];
if (
  lockedAccounts?.version !== EXPECTED_VERSION ||
  lockedAccounts.resolved !== EXPECTED_RELEASE ||
  !lockedAccounts.integrity
) {
  throw new Error(
    `Digital Solutions Accounts lock entry is incomplete or drifted: ${JSON.stringify(lockedAccounts)}`,
  );
}

if (!nextConfigSource.includes('"@bke/accounts"')) {
  throw new Error(
    "Next.js must explicitly transpile the source-native @bke/accounts package.",
  );
}

if (
  !accountsWorkflowSource.includes("node_modules/@bke/accounts/prisma/schema.prisma") ||
  !accountsWorkflowSource.includes("node_modules/@bke/accounts/migrations")
) {
  throw new Error(
    "Accounts CI must validate and compose persistence from the installed @bke/accounts package.",
  );
}

if (!migrationCompositorSource.includes("configuredMigrationsRoot")) {
  throw new Error(
    "The migration compositor must support module-owned external migration roots.",
  );
}

console.log(
  `Accounts standalone consumer adoption GREEN version=${EXPECTED_VERSION} integrity=${lockedAccounts.integrity} staging=retired purchaseAccess=package-owned`,
);
