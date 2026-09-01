import { readFile } from "node:fs/promises";

const EXPECTED_RELEASE =
  "https://github.com/jan2xo/bke-libraries-typescript/releases/download/identity-v0.1.0/bke-identity-0.1.0.tgz";
const EXPECTED_VERSION = "0.1.0";

const [moduleSource, packageSource, lockSource, nextConfigSource] =
  await Promise.all([
    readFile(new URL("../module.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../../package.json", import.meta.url), "utf8"),
    readFile(new URL("../../../../package-lock.json", import.meta.url), "utf8"),
    readFile(new URL("../../../../next.config.ts", import.meta.url), "utf8"),
  ]);

if (
  !moduleSource.includes("CapabilityModule") ||
  !moduleSource.includes('"../../contracts/capability"')
) {
  throw new Error(
    "Identity host adapter must retain the Digital Solutions CapabilityModule contract.",
  );
}

const requiredPackageSurfaces = [
  "@bke/identity/contracts/",
  "@bke/identity/logic/",
  "@bke/identity/providers/",
  "@bke/identity/prisma/repositories/",
  "@bke/identity/module.manifest",
];
for (const marker of requiredPackageSurfaces) {
  if (!moduleSource.includes(marker)) {
    throw new Error(`Identity host adapter is missing standalone package surface: ${marker}`);
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
    throw new Error(`Identity host adapter still consumes staging implementation: ${marker}`);
  }
}

const packageJson = JSON.parse(packageSource) as {
  dependencies?: Record<string, string>;
};
if (packageJson.dependencies?.["@bke/identity"] !== EXPECTED_RELEASE) {
  throw new Error(
    `Digital Solutions package.json does not pin the certified Identity artifact: ${packageJson.dependencies?.["@bke/identity"]}`,
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
  packageLock.packages?.[""]?.dependencies?.["@bke/identity"] !==
  EXPECTED_RELEASE
) {
  throw new Error(
    "Digital Solutions package-lock root does not pin the certified Identity artifact.",
  );
}

const lockedIdentity = packageLock.packages?.["node_modules/@bke/identity"];
if (
  lockedIdentity?.version !== EXPECTED_VERSION ||
  lockedIdentity.resolved !== EXPECTED_RELEASE ||
  !lockedIdentity.integrity
) {
  throw new Error(
    `Digital Solutions Identity lock entry is incomplete or drifted: ${JSON.stringify(lockedIdentity)}`,
  );
}

if (!nextConfigSource.includes('transpilePackages: ["@bke/identity"]')) {
  throw new Error(
    "Next.js must explicitly transpile the source-native @bke/identity package.",
  );
}

console.log(
  `Identity standalone consumer adoption GREEN version=${EXPECTED_VERSION} integrity=${lockedIdentity.integrity}`,
);
