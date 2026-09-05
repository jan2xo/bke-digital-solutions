import { access, readFile } from "node:fs/promises";

const EXPECTED_RELEASE =
  "https://github.com/jan2xo/bke-libraries-typescript/releases/download/licensing-v0.2.0/bke-licensing-0.2.0.tgz";
const EXPECTED_VERSION = "0.2.0";

const [
  moduleSource,
  packageSource,
  lockSource,
  nextConfigSource,
  licensingWorkflowSource,
  migrationCompositorSource,
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
  "@bke/licensing/logic/",
  "@bke/licensing/providers/",
  "@bke/licensing/prisma/repositories/",
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

console.log(
  `Licensing standalone consumer adoption + staging retirement GREEN version=${EXPECTED_VERSION} integrity=${lockedLicensing.integrity}`,
);
