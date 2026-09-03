import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_RELEASE =
  "https://github.com/jan2xo/bke-libraries-typescript/releases/download/legal-v0.3.0/bke-legal-0.3.0.tgz";
const EXPECTED_VERSION = "0.3.0";
const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const [
  moduleSource,
  packageSource,
  lockSource,
  nextConfigSource,
  legalWorkflowSource,
  migrationCompositorSource,
] = await Promise.all([
  readFile(new URL("../module.ts", import.meta.url), "utf8"),
  readFile(new URL("../../../../package.json", import.meta.url), "utf8"),
  readFile(new URL("../../../../package-lock.json", import.meta.url), "utf8"),
  readFile(new URL("../../../../next.config.ts", import.meta.url), "utf8"),
  readFile(new URL("../../../../.github/workflows/v2-legal.yml", import.meta.url), "utf8"),
  readFile(new URL("../../../platform/persistence/migration-compositor.mjs", import.meta.url), "utf8"),
]);

if (
  !moduleSource.includes("CapabilityModule") ||
  !moduleSource.includes('"../../contracts/capability"')
) {
  throw new Error("Legal host adapter must retain the Digital Solutions CapabilityModule contract.");
}

const requiredPackageSurfaces = [
  "@bke/legal/contracts/",
  "@bke/legal/logic/",
  "@bke/legal/prisma/repositories/",
  "@bke/legal/module.manifest",
];
for (const marker of requiredPackageSurfaces) {
  if (!moduleSource.includes(marker)) {
    throw new Error(`Legal host adapter is missing standalone package surface: ${marker}`);
  }
}

const requiredCheckoutRequirementSurfaces = [
  "LEGAL_CHECKOUT_REQUIREMENTS_CAPABILITY_ID",
  "createLegalCheckoutRequirementsCapability",
  "createPostgresLegalCheckoutRequirementsRepository",
];
for (const marker of requiredCheckoutRequirementSurfaces) {
  if (!moduleSource.includes(marker)) {
    throw new Error(`Legal host adapter is missing checkout requirements surface: ${marker}`);
  }
}

const requiredReacceptanceSurfaces = [
  "LEGAL_REACCEPTANCE_STATUS_CAPABILITY_ID",
  "createLegalReacceptanceStatusCapability",
  "createPostgresLegalReacceptanceStatusRepository",
];
for (const marker of requiredReacceptanceSurfaces) {
  if (!moduleSource.includes(marker)) {
    throw new Error(`Legal host adapter is missing reacceptance surface: ${marker}`);
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
    throw new Error(`Legal host adapter still consumes staging implementation: ${marker}`);
  }
}

const forbiddenStagingPaths = [
  "contracts",
  "docs",
  "logic",
  "module.manifest.ts",
  "prisma.config.ts",
  "prisma",
  "test/acceptance.test.ts",
  "test/acceptance.postgres.certify.ts",
  "test/extraction.certify.ts",
  "test/persistence-isolation.certify.ts",
  "test/module-composition.test.ts",
];
for (const path of forbiddenStagingPaths) {
  if (existsSync(resolve(moduleRoot, path))) {
    throw new Error(`Legal staging implementation was not retired: ${path}`);
  }
}

const packageJson = JSON.parse(packageSource) as { dependencies?: Record<string, string> };
if (packageJson.dependencies?.["@bke/legal"] !== EXPECTED_RELEASE) {
  throw new Error(
    `Digital Solutions package.json does not pin the certified Legal artifact: ${packageJson.dependencies?.["@bke/legal"]}`,
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
if (packageLock.packages?.[""]?.dependencies?.["@bke/legal"] !== EXPECTED_RELEASE) {
  throw new Error("Digital Solutions package-lock root does not pin the certified Legal artifact.");
}

const lockedLegal = packageLock.packages?.["node_modules/@bke/legal"];
if (
  lockedLegal?.version !== EXPECTED_VERSION ||
  lockedLegal.resolved !== EXPECTED_RELEASE ||
  !lockedLegal.integrity
) {
  throw new Error(
    `Digital Solutions Legal lock entry is incomplete or drifted: ${JSON.stringify(lockedLegal)}`,
  );
}

if (!nextConfigSource.includes('"@bke/legal"')) {
  throw new Error("Next.js must explicitly transpile the source-native @bke/legal package.");
}

if (
  !legalWorkflowSource.includes("node_modules/@bke/legal/prisma/schema.prisma") ||
  !legalWorkflowSource.includes("node_modules/@bke/legal/migrations") ||
  !legalWorkflowSource.includes("legal-v0.3.0") ||
  !legalWorkflowSource.includes("f331fe0a813a7f8d0e139a389ee15f5ae3a060234d483d465abbef3e59301ae3")
) {
  throw new Error("Legal CI must certify and compose persistence from the exact installed @bke/legal v0.3.0 artifact.");
}

if (!migrationCompositorSource.includes("configuredMigrationsRoot")) {
  throw new Error("The migration compositor must support module-owned external migration roots.");
}

console.log(
  `Legal standalone consumer adoption GREEN; checkout requirements + reacceptance exposed; staging retired; version=${EXPECTED_VERSION} integrity=${lockedLegal.integrity}`,
);
