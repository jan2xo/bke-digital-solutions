import {
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import { gt, lt, valid } from "semver";

export const BKE_SOFTWARE_CATALOG_REPOSITORY = "jan2xo/bke-software-catalog";
export const BKE_LICENSING_AGENT_PRODUCT_ID = "bke-licensing-agent";
export const LICENSING_AGENT_UPDATE_SCHEMA = "bke.update-policy.v1" as const;
export const LICENSING_AGENT_UPDATE_KEY_SCHEMA =
  "bke.update-authority-key.v1" as const;
export const LICENSING_AGENT_UPDATE_ALGORITHM = "Ed25519" as const;
export const LICENSING_AGENT_UPDATE_CHANNEL = "stable" as const;
export const LICENSING_AGENT_UPDATE_CONTENT_TYPE =
  "application/vnd.microsoft.portable-executable" as const;
export const LICENSING_AGENT_UPDATE_SECRET_REFERENCE_PREFIX = "key:" as const;
export const LICENSING_AGENT_MAX_INSTALLER_BYTES = 512 * 1024 * 1024;

export type LicensingAgentArchitecture = "x86_64" | "arm64";
export type LicensingAgentUpdateAudience = "PREPRODUCTION" | "PRODUCTION";

export type LicensingAgentUpdateRequest = Readonly<{
  currentVersion: string;
  platform: string;
  architecture: string;
}>;

export type LicensingAgentUpdateArtifact = Readonly<{
  architecture: LicensingAgentArchitecture;
  artifactId: string;
  sha256: string;
  size: number;
}>;

export type LicensingAgentUpdatePolicyConfiguration = Readonly<{
  latestVersion: string;
  minimumSupportedVersion: string;
  revision: number;
  releaseTag: string;
  publishedAt: Date;
  artifact: LicensingAgentUpdateArtifact;
  signingKeyId: string;
  signingPublicKey: string;
  signingPrivateKey: string;
}>;

export type SignedLicensingAgentUpdatePolicy = Readonly<{
  schema: typeof LICENSING_AGENT_UPDATE_SCHEMA;
  product_id: typeof BKE_LICENSING_AGENT_PRODUCT_ID;
  current_version: string;
  latest_version: string;
  minimum_supported_version: string;
  channel: typeof LICENSING_AGENT_UPDATE_CHANNEL;
  platform: "windows";
  architecture: LicensingAgentArchitecture;
  release_id: string;
  artifact_id: string;
  artifact_sha256: string;
  artifact_size: number;
  content_type: typeof LICENSING_AGENT_UPDATE_CONTENT_TYPE;
  published_at: string;
  issued_at: string;
  revision: number;
  signing_key_id: string;
  algorithm: typeof LICENSING_AGENT_UPDATE_ALGORITHM;
  signature: string;
}>;

type UnsignedPolicy = Omit<SignedLicensingAgentUpdatePolicy, "signature">;

export type VerifiedLicensingAgentGitHubRelease = Readonly<{
  version: string;
  releaseTag: string;
  publishedAt: Date;
  prerelease: boolean;
  artifacts: readonly LicensingAgentUpdateArtifact[];
}>;

export class LicensingAgentUpdateRequestError extends Error {}
export class LicensingAgentUpdateConfigurationError extends Error {}

const SAFE_KEY_ID = /^[A-Za-z0-9._-]{1,64}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export function normalizeLicensingAgentArchitecture(
  value: string,
): LicensingAgentArchitecture {
  const normalized = value.trim().toLowerCase();
  if (["x64", "amd64", "x86_64"].includes(normalized)) return "x86_64";
  if (normalized === "arm64") return "arm64";
  throw new LicensingAgentUpdateRequestError("unsupported architecture");
}

export function licensingAgentReleaseTag(version: string): string {
  if (!valid(version)) {
    throw new LicensingAgentUpdateRequestError(
      "version must be a valid semantic version",
    );
  }
  return `bke-licensing-agent-v${version}`;
}

export function licensingAgentArtifactId(
  version: string,
  architecture: LicensingAgentArchitecture,
): string {
  const suffix = architecture === "x86_64" ? "x64" : "arm64";
  return `BKE-Licensing-Agent-${version}-Windows-${suffix}.exe`;
}

export function canonicalUnsignedPolicy(policy: UnsignedPolicy): Buffer {
  return Buffer.from(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(policy).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
    ),
    "utf8",
  );
}

function parsePrivateKey(value: string): KeyObject {
  try {
    const raw = value.includes("BEGIN")
      ? value
      : Buffer.from(value, "base64").toString("utf8");
    const key = createPrivateKey(raw);
    if (key.asymmetricKeyType !== "ed25519") throw new Error("not Ed25519");
    return key;
  } catch (error) {
    throw new LicensingAgentUpdateConfigurationError(
      `update signing private key is invalid: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  }
}

export function rawEd25519PublicKeyFromPrivate(privateValue: string): Buffer {
  const jwk = createPublicKey(parsePrivateKey(privateValue)).export({
    format: "jwk",
  });
  if (!("x" in jwk) || typeof jwk.x !== "string") {
    throw new LicensingAgentUpdateConfigurationError(
      "update signing public key is unavailable",
    );
  }
  const raw = Buffer.from(jwk.x, "base64url");
  if (raw.length !== 32) {
    throw new LicensingAgentUpdateConfigurationError(
      "update signing public key must be 32 bytes",
    );
  }
  return raw;
}

export function assertLicensingAgentSigningMaterial(
  publicKeyBase64: string,
  privateValue: string,
): void {
  const supplied = Buffer.from(publicKeyBase64, "base64");
  const normalizedInput = publicKeyBase64.replace(/=+$/u, "");
  const normalizedRoundTrip = supplied.toString("base64").replace(/=+$/u, "");
  if (
    supplied.length !== 32 ||
    normalizedInput !== normalizedRoundTrip ||
    !supplied.equals(rawEd25519PublicKeyFromPrivate(privateValue))
  ) {
    throw new LicensingAgentUpdateConfigurationError(
      "update signing public/private key mismatch",
    );
  }
}

export function signLicensingAgentUpdatePolicy(
  request: LicensingAgentUpdateRequest,
  configuration: LicensingAgentUpdatePolicyConfiguration,
  issuedAt = new Date(),
): SignedLicensingAgentUpdatePolicy {
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
  if (architecture !== configuration.artifact.architecture) {
    throw new LicensingAgentUpdateConfigurationError(
      "update artifact architecture mismatch",
    );
  }
  if (
    !valid(configuration.latestVersion) ||
    !valid(configuration.minimumSupportedVersion)
  ) {
    throw new LicensingAgentUpdateConfigurationError(
      "update authority versions are invalid",
    );
  }
  if (gt(configuration.minimumSupportedVersion, configuration.latestVersion)) {
    throw new LicensingAgentUpdateConfigurationError(
      "minimum supported version cannot exceed latest version",
    );
  }
  if (gt(currentVersion, configuration.latestVersion)) {
    throw new LicensingAgentUpdateRequestError(
      "installed version is newer than update authority",
    );
  }
  if (
    !Number.isSafeInteger(configuration.revision) ||
    configuration.revision < 1
  ) {
    throw new LicensingAgentUpdateConfigurationError(
      "update authority revision is invalid",
    );
  }
  if (!SAFE_KEY_ID.test(configuration.signingKeyId)) {
    throw new LicensingAgentUpdateConfigurationError(
      "update signing key id is malformed",
    );
  }
  if (
    !SHA256.test(configuration.artifact.sha256) ||
    !Number.isSafeInteger(configuration.artifact.size) ||
    configuration.artifact.size < 2 ||
    configuration.artifact.size > LICENSING_AGENT_MAX_INSTALLER_BYTES
  ) {
    throw new LicensingAgentUpdateConfigurationError(
      "update artifact identity is invalid",
    );
  }
  if (
    configuration.releaseTag !==
      licensingAgentReleaseTag(configuration.latestVersion) ||
    configuration.artifact.artifactId !==
      licensingAgentArtifactId(
        configuration.latestVersion,
        configuration.artifact.architecture,
      )
  ) {
    throw new LicensingAgentUpdateConfigurationError(
      "update release identity is invalid",
    );
  }

  assertLicensingAgentSigningMaterial(
    configuration.signingPublicKey,
    configuration.signingPrivateKey,
  );

  const unsigned: UnsignedPolicy = {
    schema: LICENSING_AGENT_UPDATE_SCHEMA,
    product_id: BKE_LICENSING_AGENT_PRODUCT_ID,
    current_version: currentVersion,
    latest_version: configuration.latestVersion,
    minimum_supported_version: configuration.minimumSupportedVersion,
    channel: LICENSING_AGENT_UPDATE_CHANNEL,
    platform: "windows",
    architecture,
    release_id: configuration.releaseTag,
    artifact_id: configuration.artifact.artifactId,
    artifact_sha256: configuration.artifact.sha256,
    artifact_size: configuration.artifact.size,
    content_type: LICENSING_AGENT_UPDATE_CONTENT_TYPE,
    published_at: configuration.publishedAt.toISOString(),
    issued_at: issuedAt.toISOString(),
    revision: configuration.revision,
    signing_key_id: configuration.signingKeyId,
    algorithm: LICENSING_AGENT_UPDATE_ALGORITHM,
  };

  const privateKey = parsePrivateKey(configuration.signingPrivateKey);
  const canonical = canonicalUnsignedPolicy(unsigned);
  const signature = sign(null, canonical, privateKey);
  if (!verify(null, canonical, createPublicKey(privateKey), signature)) {
    throw new LicensingAgentUpdateConfigurationError(
      "update policy signing self-verification failed",
    );
  }

  return Object.freeze({
    ...unsigned,
    signature: signature.toString("base64"),
  });
}

export function updateAvailable(
  policy: SignedLicensingAgentUpdatePolicy,
): boolean {
  return gt(policy.latest_version, policy.current_version);
}

export function updateRequired(
  policy: SignedLicensingAgentUpdatePolicy,
): boolean {
  return lt(policy.current_version, policy.minimum_supported_version);
}

type GitHubReleaseAsset = Readonly<{
  name?: unknown;
  size?: unknown;
  digest?: unknown;
}>;

type GitHubReleaseDocument = Readonly<{
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  published_at?: unknown;
  assets?: unknown;
}>;

export async function inspectLicensingAgentGitHubRelease(
  version: string,
  audience: LicensingAgentUpdateAudience,
  fetcher: typeof fetch = fetch,
): Promise<VerifiedLicensingAgentGitHubRelease> {
  const releaseTag = licensingAgentReleaseTag(version);
  const response = await fetcher(
    `https://api.github.com/repos/${BKE_SOFTWARE_CATALOG_REPOSITORY}/releases/tags/${encodeURIComponent(releaseTag)}`,
    {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "BKE-Digital-Solutions-Agent-Update-Authority",
      },
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new LicensingAgentUpdateConfigurationError(
      `GitHub Agent release verification failed with HTTP ${response.status}`,
    );
  }

  const release = (await response.json()) as GitHubReleaseDocument;
  if (
    release.tag_name !== releaseTag ||
    release.draft !== false ||
    typeof release.prerelease !== "boolean" ||
    typeof release.published_at !== "string" ||
    !Array.isArray(release.assets)
  ) {
    throw new LicensingAgentUpdateConfigurationError(
      "GitHub Agent release metadata is invalid",
    );
  }
  if (
    (audience === "PREPRODUCTION" && !release.prerelease) ||
    (audience === "PRODUCTION" && release.prerelease)
  ) {
    throw new LicensingAgentUpdateConfigurationError(
      "GitHub Agent release audience does not match prerelease state",
    );
  }

  const publishedAt = new Date(release.published_at);
  if (Number.isNaN(publishedAt.valueOf())) {
    throw new LicensingAgentUpdateConfigurationError(
      "GitHub Agent release published_at is invalid",
    );
  }

  const assets = (release.assets as GitHubReleaseAsset[]).flatMap(
    (asset): LicensingAgentUpdateArtifact[] => {
      const architecture = (["x86_64", "arm64"] as const).find(
        (candidate) =>
          asset.name === licensingAgentArtifactId(version, candidate),
      );
      if (!architecture) return [];
      const digest =
        typeof asset.digest === "string" &&
        asset.digest.startsWith("sha256:")
          ? asset.digest.slice("sha256:".length)
          : "";
      if (
        !SHA256.test(digest) ||
        typeof asset.size !== "number" ||
        !Number.isSafeInteger(asset.size) ||
        asset.size < 2 ||
        asset.size > LICENSING_AGENT_MAX_INSTALLER_BYTES
      ) {
        throw new LicensingAgentUpdateConfigurationError(
          `GitHub Agent release asset metadata is invalid for ${architecture}`,
        );
      }
      return [{
        architecture,
        artifactId: asset.name as string,
        sha256: digest,
        size: asset.size,
      }];
    },
  );

  if (!assets.some((artifact) => artifact.architecture === "x86_64")) {
    throw new LicensingAgentUpdateConfigurationError(
      "GitHub Agent release is missing the required Windows x64 installer",
    );
  }

  return Object.freeze({
    version,
    releaseTag,
    publishedAt,
    prerelease: release.prerelease,
    artifacts: Object.freeze(assets),
  });
}
