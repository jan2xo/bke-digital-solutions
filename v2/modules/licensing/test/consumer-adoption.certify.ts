import { access, readFile } from "node:fs/promises";

const EXPECTED_RELEASE =
  "https://github.com/jan2xo/bke-libraries-typescript/releases/download/licensing-v0.8.1/bke-licensing-0.8.1.tgz";
const EXPECTED_VERSION = "0.8.1";

const [
  moduleSource,
  packageSource,
  lockSource,
  nextConfigSource,
  licensingWorkflowSource,
  migrationCompositorSource,
  signingRegistryHostSource,
  signingKeysRouteSource,
  refreshRouteSource,
  airstackGraceRouteSource,
  renderdockGraceRouteSource,
  graceCliSource,
] = await Promise.all([
  readFile(new URL("../module.ts", import.meta.url), "utf8"),
  readFile(new URL("../../../../package.json", import.meta.url), "utf8"),
  readFile(new URL("../../../../package-lock.json", import.meta.url), "utf8"),
  readFile(new URL("../../../../next.config.ts", import.meta.url), "utf8"),
  readFile(
    new URL("../../../../.github/workflows/v2-licensing.yml", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../../../platform/persistence/migration-compositor.mjs", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../../../apps/web/licensing/signing-key-registry.ts", import.meta.url), "utf8"),
  readFile(new URL("../../../../app/api/licensing/keys/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../../../../app/api/licenses/refresh/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../../../../app/api/graceperiod/airstack/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../../../../app/api/graceperiod/renderdock/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../../../../scripts/grace-period.ts", import.meta.url), "utf8"),
]);

if (
  !moduleSource.includes("CapabilityModule") ||
  !moduleSource.includes('"../../contracts/capability"')
) {
  throw new Error(
    "Licensing host adapter must retain the Digital Solutions CapabilityModule contract.",
  );
}

const requiredPackageSurfaces = [
  "@bke/licensing/contracts/",
  "LICENSING_COMMERCIAL_LEASE_CAPABILITY_ID",
  "LICENSING_TRANSFER_POLICY_CAPABILITY_ID",
  "LICENSING_SIGNING_KEY_REGISTRY_CAPABILITY_ID",
  "LICENSING_GRACE_PERIOD_CAPABILITY_ID",
  "@bke/licensing/logic/",
  "@bke/licensing/logic/commercial-lease",
  "createCommercialLeaseCapability",
  "@bke/licensing/logic/commercial-license-context",
  "createCommercialLicenseContextProvider",
  "@bke/licensing/logic/grace-period",
  "createLicensingGracePeriodCapability",
  "@bke/licensing/providers/",
  "@bke/licensing/prisma/repositories/",
  "@bke/licensing/prisma/repositories/postgres-commercial-lease-store",
  "createPostgresCommercialLeaseStore",
  "@bke/licensing/prisma/repositories/postgres-commercial-signing-key-provider",
  "createPostgresCommercialSigningKeyProvider",
  "@bke/licensing/prisma/repositories/postgres-signing-key-registry-repository",
  "createPostgresLicensingSigningKeyRegistryCapability",
  "@bke/licensing/prisma/repositories/postgres-license-lookup-repository",
  "createPostgresLicensingLicenseLookupRepository",
  "@bke/licensing/prisma/repositories/postgres-transfer-policy-repository",
  "createPostgresLicensingTransferPolicyCapability",
  "@bke/licensing/prisma/repositories/postgres-grace-period-store",
  "createPostgresLicensingGracePeriodStore",
  "ACCOUNTS_ACCOUNT_LIFECYCLE_CAPABILITY_ID",
  "CATALOG_LICENSING_VERSION_FACTS_CAPABILITY_ID",
  "COMMERCE_ORDER_ITEM_POLICY_LOOKUP_CAPABILITY_ID",
  "COMMERCE_SUBSCRIPTION_STATUS_LOOKUP_CAPABILITY_ID",
  'createHmac("sha256", options.licensePepper)',
  "@bke/licensing/module.manifest",
];
for (const marker of requiredPackageSurfaces) {
  if (!moduleSource.includes(marker)) {
    throw new Error(`Licensing host adapter is missing standalone package surface: ${marker}`);
  }
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
    throw new Error(`Licensing host adapter still consumes staging implementation: ${marker}`);
  }
}

const retiredStagingPaths = [
  "../contracts",
  "../docs",
  "../logic",
  "../providers",
  "../prisma",
  "../module.manifest.ts",
  "../prisma.config.ts",
  "./extraction.certify.ts",
  "./license-key-reveal.postgres.certify.ts",
  "./license-key-reveal.test.ts",
  "./module-composition.test.ts",
  "./persistence-isolation.certify.ts",
];

async function pathExists(relativePath: string): Promise<boolean> {
  try {
    await access(new URL(relativePath, import.meta.url));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

for (const retiredPath of retiredStagingPaths) {
  if (await pathExists(retiredPath)) {
    throw new Error(`Retired Licensing staging path reappeared: ${retiredPath}`);
  }
}

const packageJson = JSON.parse(packageSource) as {
  dependencies?: Record<string, string>;
};
if (packageJson.dependencies?.["@bke/licensing"] !== EXPECTED_RELEASE) {
  throw new Error(
    `Digital Solutions package.json does not pin the certified Licensing artifact: ${packageJson.dependencies?.["@bke/licensing"]}`,
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
  packageLock.packages?.[""]?.dependencies?.["@bke/licensing"] !== EXPECTED_RELEASE
) {
  throw new Error(
    "Digital Solutions package-lock root does not pin the certified Licensing artifact.",
  );
}

const lockedLicensing = packageLock.packages?.["node_modules/@bke/licensing"];
if (
  lockedLicensing?.version !== EXPECTED_VERSION ||
  lockedLicensing.resolved !== EXPECTED_RELEASE ||
  !lockedLicensing.integrity
) {
  throw new Error(
    `Digital Solutions Licensing lock entry is incomplete or drifted: ${JSON.stringify(lockedLicensing)}`,
  );
}

if (!nextConfigSource.includes('"@bke/licensing"')) {
  throw new Error(
    "Next.js must explicitly transpile the source-native @bke/licensing package.",
  );
}

if (
  !licensingWorkflowSource.includes("node_modules/@bke/licensing/prisma/schema.prisma") ||
  !licensingWorkflowSource.includes("node_modules/@bke/licensing/migrations")
) {
  throw new Error(
    "Licensing CI must validate and compose persistence from the installed @bke/licensing package.",
  );
}

if (!migrationCompositorSource.includes("configuredMigrationsRoot")) {
  throw new Error(
    "The migration compositor must support module-owned external migration roots.",
  );
}

for (const marker of [
  "LICENSING_SIGNING_KEY_REGISTRY_CAPABILITY_ID",
  "ensureLicensingSigningKey",
  "activeLicensingSigningKey",
  "listPublicLicensingSigningKeys",
]) {
  if (!signingRegistryHostSource.includes(marker)) {
    throw new Error(`Licensing signing-key host adapter missing capability surface: ${marker}`);
  }
}
for (const [name, source] of [["keys", signingKeysRouteSource], ["refresh", refreshRouteSource]] as const) {
  if (source.includes("@/lib/licensing/signing-registry")) {
    throw new Error(`${name} route still reaches through to V1 signing registry.`);
  }
  if (!source.includes("@/v2/apps/web/licensing/signing-key-registry")) {
    throw new Error(`${name} route does not consume the V2 signing-key registry adapter.`);
  }
}

for (const [name, source] of [
  ["airstack grace", airstackGraceRouteSource],
  ["renderdock grace", renderdockGraceRouteSource],
] as const) {
  if (source.includes("@/lib/grace-period")) {
    throw new Error(`${name} route still reaches through to V1 grace-period implementation.`);
  }
  if (!source.includes("LICENSING_GRACE_PERIOD_CAPABILITY_ID")) {
    throw new Error(`${name} route does not consume the released Licensing Grace capability.`);
  }
}
if (graceCliSource.includes("../lib/grace-period")) {
  throw new Error("Grace CLI still reaches through to V1 grace-period implementation.");
}
if (
  !graceCliSource.includes("createLicensingGracePeriodCapability") ||
  !graceCliSource.includes("createPostgresLicensingGracePeriodStore") ||
  !graceCliSource.includes('operationSource: "VPS_CLI"')
) {
  throw new Error("Grace CLI does not compose the released Licensing Grace capability with VPS_CLI semantics.");
}

console.log(
  `Licensing standalone consumer adoption + staging retirement GREEN version=${EXPECTED_VERSION} integrity=${lockedLicensing.integrity}`,
);
