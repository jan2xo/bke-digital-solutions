import { readdir, readFile, stat } from "node:fs/promises";

const EXPECTED_RELEASE =
  "https://github.com/jan2xo/bke-libraries-typescript/releases/download/identity-v0.3.0/bke-identity-0.3.0.tgz";
const EXPECTED_VERSION = "0.3.0";

const [
  moduleSource,
  packageSource,
  lockSource,
  nextConfigSource,
  identityWorkflowSource,
  migrationCompositorSource,
  installedIdentityContractSource,
  installedSessionAdministrationContractSource,
  sessionAdministrationHostSource,
  sessionsRouteSource,
  installedLoginMfaChallengeReissueContractSource,
  mfaChallengeHostSource,
  loginRouteSource,
  mfaChallengeRequestRouteSource,
  mfaChallengeRouteSource,
] = await Promise.all([
  readFile(new URL("../module.ts", import.meta.url), "utf8"),
  readFile(new URL("../../../../package.json", import.meta.url), "utf8"),
  readFile(new URL("../../../../package-lock.json", import.meta.url), "utf8"),
  readFile(new URL("../../../../next.config.ts", import.meta.url), "utf8"),
  readFile(
    new URL("../../../../.github/workflows/v2-identity.yml", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../../../platform/persistence/migration-compositor.mjs", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../../../../node_modules/@bke/identity/contracts/identity.contract.ts", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../../../../node_modules/@bke/identity/contracts/session-administration.contract.ts", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../../../apps/web/security/session-administration.ts", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../../../../app/api/admin/security/sessions/route.ts", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../../../../node_modules/@bke/identity/contracts/login-mfa-challenge-reissue.contract.ts", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../../../apps/web/auth/mfa-challenge.ts", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../../../../app/api/auth/login/route.ts", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../../../../app/api/auth/mfa/challenge/request/route.ts", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../../../../app/api/auth/mfa/challenge/route.ts", import.meta.url),
    "utf8",
  ),
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

if (!installedIdentityContractSource.includes("readonly establishedAt: Date;")) {
  throw new Error(
    "Installed @bke/identity contract does not expose the canonical principal establishment fact.",
  );
}

for (const marker of [
  "IDENTITY_SESSION_ADMINISTRATION_CAPABILITY_ID",
  "createIdentitySessionAdministrationCapability",
  "createPostgresIdentitySessionAdministrationRepository",
  "...identityModuleManifest.provides",
]) {
  if (!moduleSource.includes(marker)) {
    throw new Error(`Identity host adapter is missing released session-administration adoption: ${marker}`);
  }
}
if (!installedSessionAdministrationContractSource.includes("bke.identity.session-administration.v1")) {
  throw new Error("Installed @bke/identity does not expose the released session-administration capability.");
}
for (const marker of [
  "IDENTITY_SESSION_ADMINISTRATION_CAPABILITY_ID",
  "securityEvent(",
  "SECURITY_SESSIONS_REVOKED",
  "EmailOutbox",
]) {
  if (!sessionAdministrationHostSource.includes(marker)) {
    throw new Error(`V2 session-administration host adapter is missing required composition/effect surface: ${marker}`);
  }
}
if (sessionsRouteSource.includes("@/lib/security/session-administration")) {
  throw new Error("Admin sessions route still reaches through to V1 session administration.");
}
if (!sessionsRouteSource.includes("@/v2/apps/web/security/session-administration")) {
  throw new Error("Admin sessions route does not consume the V2 session-administration host adapter.");
}

for (const marker of [
  "IDENTITY_LOGIN_MFA_CHALLENGE_REISSUE_CAPABILITY_ID",
  "createIdentityLoginMfaChallengeReissueCapability",
  "loginMfaChallengeIssuance",
  "loginMfaChallengeReissue",
]) {
  if (!moduleSource.includes(marker)) {
    throw new Error(`Identity host adapter is missing released LOGIN MFA reissue adoption: ${marker}`);
  }
}
if (!installedLoginMfaChallengeReissueContractSource.includes("bke.identity.login-mfa-challenge-reissue.v1")) {
  throw new Error("Installed @bke/identity does not expose the released LOGIN MFA challenge reissue capability.");
}
for (const marker of [
  "IDENTITY_LOGIN_MFA_CHALLENGE_ISSUANCE_CAPABILITY_ID",
  "IDENTITY_LOGIN_MFA_CHALLENGE_REISSUE_CAPABILITY_ID",
  "IDENTITY_LOGIN_MFA_VERIFICATION_CAPABILITY_ID",
  "issueIdentityLoginMfaChallenge",
  "reissueIdentityLoginMfaChallenge",
  "verifyIdentityLoginMfaChallenge",
]) {
  if (!mfaChallengeHostSource.includes(marker)) {
    throw new Error(`V2 LOGIN MFA host adapter is missing released Identity composition: ${marker}`);
  }
}
for (const [name, source] of [
  ["login", loginRouteSource],
  ["challenge request", mfaChallengeRequestRouteSource],
  ["challenge completion", mfaChallengeRouteSource],
] as const) {
  if (source.includes("@/lib/admin-mfa")) {
    throw new Error(`${name} route still reaches through to V1 admin MFA.`);
  }
}
if (!loginRouteSource.includes("issueIdentityLoginMfaChallenge")) {
  throw new Error("Login route does not consume released Identity LOGIN MFA issuance through the V2 adapter.");
}
if (!mfaChallengeRequestRouteSource.includes("reissueIdentityLoginMfaChallenge")) {
  throw new Error("LOGIN MFA resend route does not consume released Identity reissue through the V2 adapter.");
}
if (!mfaChallengeRouteSource.includes("verifyIdentityLoginMfaChallenge")) {
  throw new Error("LOGIN MFA completion route does not consume released Identity verification through the V2 adapter.");
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

if (!nextConfigSource.includes('"@bke/identity"')) {
  throw new Error(
    "Next.js must explicitly transpile the source-native @bke/identity package.",
  );
}

if (
  !identityWorkflowSource.includes("node_modules/@bke/identity/prisma/schema.prisma") ||
  !identityWorkflowSource.includes("node_modules/@bke/identity/migrations")
) {
  throw new Error(
    "Identity CI must validate and compose persistence from the installed @bke/identity package.",
  );
}

if (!migrationCompositorSource.includes("configuredMigrationsRoot")) {
  throw new Error(
    "The migration compositor must support module-owned external migration roots.",
  );
}

const forbiddenLocalIdentitySurface = [
  "../contracts",
  "../logic",
  "../prisma",
  "../docs",
  "../module.manifest.ts",
  "../prisma.config.ts",
];
for (const relativePath of forbiddenLocalIdentitySurface) {
  const target = new URL(relativePath, import.meta.url);
  const exists = await stat(target)
    .then(() => true)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    });
  if (exists) {
    throw new Error(`Retired Identity staging surface reappeared: ${relativePath}`);
  }
}

const localTests = (await readdir(new URL(".", import.meta.url))).sort();
if (
  localTests.length !== 1 ||
  localTests[0] !== "consumer-adoption.certify.ts"
) {
  throw new Error(
    `Digital Solutions Identity must retain only its consumer certification; found ${JSON.stringify(localTests)}`,
  );
}

console.log(
  `Identity standalone consumer adoption GREEN; establishedAt exposed; version=${EXPECTED_VERSION} integrity=${lockedIdentity.integrity}`,
);
