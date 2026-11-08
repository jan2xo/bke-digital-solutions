import { readdir, readFile, stat } from "node:fs/promises";
const EXPECTED_RELEASE = "https://github.com/jan2xo/bke-libraries-typescript/releases/download/identity-v0.5.0/bke-identity-0.5.0.tgz";
const EXPECTED_VERSION = "0.5.0";
const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");
const [moduleSource, packageSource, lockSource, nextConfigSource, workflowSource,
  compositorSource, installedIdentity, installedAdministration, administrationHost, sessionsRoute] =
  await Promise.all([
    read("../module.ts"), read("../../../package.json"), read("../../../package-lock.json"),
    read("../../../next.config.ts"), read("../../../.github/workflows/v2-identity.yml"),
    read("../../../platform/persistence/migration-compositor.mjs"),
    read("../../../node_modules/@bke/identity/contracts/identity.contract.ts"),
    read("../../../node_modules/@bke/identity/contracts/session-administration.contract.ts"),
    read("../../../apps/web/security/session-administration.ts"),
    read("../../../app/api/admin/security/sessions/route.ts"),
  ]);
for (const marker of ["CapabilityModule", '"../../contracts/capability"', "@bke/identity/contracts/",
  "@bke/identity/logic/", "@bke/identity/providers/", "@bke/identity/prisma/repositories/",
  "@bke/identity/module.manifest", "IDENTITY_GOOGLE_AUTHENTICATION_CAPABILITY_ID",
  "IDENTITY_SESSION_ADMINISTRATION_CAPABILITY_ID", "createIdentitySessionAdministrationCapability"]) {
  if (!moduleSource.includes(marker)) throw new Error(`Missing released Identity consumer surface: ${marker}`);
}
if (/IDENTITY_(?:LOGIN_MFA|MFA_|PASSWORD_|MAGIC_|EMAIL_VERIFICATION|RECENT_AUTH_)/.test(moduleSource)) {
  throw new Error("Digital Solutions must not expose retired authentication capabilities.");
}
if (!installedIdentity.includes("readonly establishedAt: Date;") ||
    !installedAdministration.includes("bke.identity.session-administration.v1")) {
  throw new Error("Installed Identity principal/session-administration contracts are incompatible.");
}
for (const marker of ["IDENTITY_SESSION_ADMINISTRATION_CAPABILITY_ID", "securityEvent(", "SECURITY_SESSIONS_REVOKED", "EmailOutbox"]) {
  if (!administrationHost.includes(marker)) throw new Error(`Missing revocation effect: ${marker}`);
}
if (sessionsRoute.includes("@/lib/security/session-administration") ||
    !sessionsRoute.includes("@/apps/web/security/session-administration")) {
  throw new Error("Administrator revocation must retain the released V2 session capability.");
}
const packageJson = JSON.parse(packageSource);
const lock = JSON.parse(lockSource);
const installed = lock.packages?.["node_modules/@bke/identity"];
if (packageJson.dependencies?.["@bke/identity"] !== EXPECTED_RELEASE ||
    lock.packages?.[""]?.dependencies?.["@bke/identity"] !== EXPECTED_RELEASE ||
    installed?.version !== EXPECTED_VERSION || installed?.resolved !== EXPECTED_RELEASE || !installed?.integrity) {
  throw new Error("Identity package/lock must retain the immutable certified shared release.");
}
if (!nextConfigSource.includes('"@bke/identity"') ||
    !workflowSource.includes("node_modules/@bke/identity/prisma/schema.prisma") ||
    !workflowSource.includes("node_modules/@bke/identity/migrations") ||
    !compositorSource.includes("configuredMigrationsRoot")) {
  throw new Error("Source-native compilation and installed-package persistence adoption must remain configured.");
}
for (const marker of ['"./contracts/', '"./logic/', '"./prisma/repositories/', '"./module.manifest"']) {
  if (moduleSource.includes(marker)) throw new Error(`Retired local Identity implementation: ${marker}`);
}
for (const path of ["../contracts", "../logic", "../prisma", "../docs", "../module.manifest.ts", "../prisma.config.ts"]) {
  const exists = await stat(new URL(path, import.meta.url)).then(() => true).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
  if (exists) throw new Error(`Retired Identity staging surface reappeared: ${path}`);
}
const localTests = (await readdir(new URL(".", import.meta.url))).sort();
if (localTests.length !== 1 || localTests[0] !== "consumer-adoption.certify.ts") {
  throw new Error("Only consumer certification belongs in the local Identity module.");
}
console.log(`Identity Google-only consumer adoption GREEN; shared version=${EXPECTED_VERSION} integrity=${installed.integrity}`);
