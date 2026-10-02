import "server-only";

import { lte, rcompare, valid } from "semver";
import { getPostgresPool } from "@/apps/web/persistence/postgres";
import {
  LICENSING_AGENT_UPDATE_SECRET_REFERENCE_PREFIX,
  LicensingAgentUpdateConfigurationError,
  LicensingAgentUpdateRequestError,
  normalizeLicensingAgentArchitecture,
  signLicensingAgentUpdatePolicy,
  type LicensingAgentUpdateAudience,
  type LicensingAgentUpdateRequest,
  type SignedLicensingAgentUpdatePolicy,
} from "@/platform/distribution/licensing-agent-update-contract";

type ReleaseRow = Readonly<{
  version: string;
  minimumSupportedVersion: string;
  revision: number;
  releaseTag: string;
  publishedAt: Date;
  architecture: "x86_64" | "arm64";
  artifactId: string;
  sha256: string;
  sizeBytes: string;
}>;

type KeyRow = Readonly<{
  keyId: string;
  publicKey: string;
  privateKeyReference: string;
  trustedFromVersion: string;
}>;

export function licensingAgentUpdateAudience(
  environment: NodeJS.ProcessEnv | Record<string, string | undefined> =
    process.env,
): LicensingAgentUpdateAudience {
  return environment.DEPLOYMENT_ENV === "production"
    ? "PRODUCTION"
    : "PREPRODUCTION";
}

export function licensingAgentUpdateKeyReference(keyId: string): string {
  if (!/^[A-Za-z0-9._-]{1,64}$/u.test(keyId)) {
    throw new LicensingAgentUpdateConfigurationError(
      "Agent update signing key id is malformed",
    );
  }
  return `${LICENSING_AGENT_UPDATE_SECRET_REFERENCE_PREFIX}${keyId}`;
}

export function resolveLicensingAgentUpdatePrivateKey(
  reference: string,
  environment: NodeJS.ProcessEnv | Record<string, string | undefined> =
    process.env,
): string {
  if (!reference.startsWith(LICENSING_AGENT_UPDATE_SECRET_REFERENCE_PREFIX)) {
    throw new LicensingAgentUpdateConfigurationError(
      "unsupported Agent update signing-key reference",
    );
  }
  const keyId = reference.slice(
    LICENSING_AGENT_UPDATE_SECRET_REFERENCE_PREFIX.length,
  );
  if (licensingAgentUpdateKeyReference(keyId) !== reference) {
    throw new LicensingAgentUpdateConfigurationError(
      "Agent update signing-key reference is malformed",
    );
  }

  const raw = environment.BKE_AGENT_UPDATE_SIGNING_KEYS?.trim();
  if (!raw) {
    throw new LicensingAgentUpdateConfigurationError(
      "Agent update signing key map is unavailable",
    );
  }

  let map: unknown;
  try {
    map = JSON.parse(raw);
  } catch {
    throw new LicensingAgentUpdateConfigurationError(
      "Agent update signing key map is malformed",
    );
  }
  if (
    map === null ||
    Array.isArray(map) ||
    typeof map !== "object"
  ) {
    throw new LicensingAgentUpdateConfigurationError(
      "Agent update signing key map is malformed",
    );
  }
  const value = (map as Record<string, unknown>)[keyId];
  if (typeof value !== "string" || !value.trim()) {
    throw new LicensingAgentUpdateConfigurationError(
      "Agent update signing private key is unavailable",
    );
  }
  return value.trim();
}

export async function resolveSignedLicensingAgentUpdate(
  request: LicensingAgentUpdateRequest,
  issuedAt = new Date(),
): Promise<SignedLicensingAgentUpdatePolicy> {
  const currentVersion = request.currentVersion.trim();
  if (!valid(currentVersion)) {
    throw new LicensingAgentUpdateRequestError(
      "version must be a valid semantic version",
    );
  }
  if (request.platform.trim().toLowerCase() !== "windows") {
    throw new LicensingAgentUpdateRequestError("unsupported platform");
  }
  const architecture = normalizeLicensingAgentArchitecture(
    request.architecture,
  );

  const audience = licensingAgentUpdateAudience();
  const pool = getPostgresPool();
  const release = (
    await pool.query<ReleaseRow>(
      `SELECT
         r."version",
         r."minimumSupportedVersion",
         r."revision",
         r."releaseTag",
         r."publishedAt",
         a."architecture",
         a."artifactId",
         a."sha256",
         a."sizeBytes"
       FROM "LicensingAgentUpdateRelease" r
       JOIN "LicensingAgentUpdateArtifact" a
         ON a."releaseId" = r."id"
       WHERE r."audience" = $1
         AND r."active" = true
         AND a."architecture" = $2
       LIMIT 1`,
      [audience, architecture],
    )
  ).rows[0];
  if (!release) {
    throw new LicensingAgentUpdateConfigurationError(
      "active Agent update release is unavailable",
    );
  }

  const keys = (
    await pool.query<KeyRow>(
      `SELECT "keyId", "publicKey", "privateKeyReference", "trustedFromVersion"
         FROM "LicensingAgentUpdateKey"
        WHERE "status" = 'ACTIVE'`,
    )
  ).rows
    .filter(
      (key) =>
        valid(key.trustedFromVersion) &&
        lte(key.trustedFromVersion, currentVersion),
    )
    .sort((left, right) =>
      rcompare(left.trustedFromVersion, right.trustedFromVersion),
    );
  const key = keys[0];
  if (!key) {
    throw new LicensingAgentUpdateConfigurationError(
      "no trusted Agent update signing key is compatible with this client",
    );
  }

  const size = Number(release.sizeBytes);
  if (!Number.isSafeInteger(size)) {
    throw new LicensingAgentUpdateConfigurationError(
      "Agent update artifact size is invalid",
    );
  }

  return signLicensingAgentUpdatePolicy(
    request,
    {
      latestVersion: release.version,
      minimumSupportedVersion: release.minimumSupportedVersion,
      revision: release.revision,
      releaseTag: release.releaseTag,
      publishedAt: release.publishedAt,
      artifact: {
        architecture: release.architecture,
        artifactId: release.artifactId,
        sha256: release.sha256,
        size,
      },
      signingKeyId: key.keyId,
      signingPublicKey: key.publicKey,
      signingPrivateKey: resolveLicensingAgentUpdatePrivateKey(
        key.privateKeyReference,
      ),
    },
    issuedAt,
  );
}
