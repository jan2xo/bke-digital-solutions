import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { valid, gt, lt } from "semver";

export const LICENSING_AGENT_PRODUCT_ID = "bke-licensing-agent";
export const LICENSING_AGENT_UPDATE_SCHEMA = "bke.update-policy.v1";
export const LICENSING_AGENT_UPDATE_ALGORITHM = "Ed25519" as const;
export const LICENSING_AGENT_UPDATE_CHANNEL = "stable" as const;
export const LICENSING_AGENT_UPDATE_CONTENT_TYPE = "application/vnd.microsoft.portable-executable";

export type LicensingAgentArchitecture = "x86_64" | "arm64";

export type LicensingAgentUpdateRequest = {
  currentVersion: string;
  platform: string;
  architecture: string;
};

export type LicensingAgentArtifactConfiguration = {
  sha256: string;
  size: number;
};

export type LicensingAgentUpdateConfiguration = {
  latestVersion: string;
  minimumSupportedVersion: string;
  revision: number;
  signingKeyId: string;
  signingPrivateKey: string;
  publishedAt: string;
  artifacts: Record<LicensingAgentArchitecture, LicensingAgentArtifactConfiguration>;
};

export type SignedLicensingAgentUpdatePolicy = {
  schema: typeof LICENSING_AGENT_UPDATE_SCHEMA;
  product_id: typeof LICENSING_AGENT_PRODUCT_ID;
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
};

type UnsignedPolicy = Omit<SignedLicensingAgentUpdatePolicy, "signature">;

export class LicensingAgentUpdateRequestError extends Error {}
export class LicensingAgentUpdateConfigurationError extends Error {}

const SAFE_KEY_ID = /^[A-Za-z0-9._-]{1,64}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_INSTALLER_BYTES = 512 * 1024 * 1024;

export function normalizeLicensingAgentArchitecture(value: string): LicensingAgentArchitecture {
  const normalized = value.trim().toLowerCase();
  if (["x64", "amd64", "x86_64"].includes(normalized)) return "x86_64";
  if (normalized === "arm64") return "arm64";
  throw new LicensingAgentUpdateRequestError("unsupported architecture");
}

export function licensingAgentUpdateConfigurationFromEnvironment(
  environment: NodeJS.ProcessEnv | Record<string, string | undefined>,
): LicensingAgentUpdateConfiguration {
  const required = (name: string) => {
    const value = environment[name]?.trim();
    if (!value) throw new LicensingAgentUpdateConfigurationError(`${name} is not configured`);
    return value;
  };
  const integer = (name: string) => {
    const raw = required(name);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new LicensingAgentUpdateConfigurationError(`${name} must be a positive integer`);
    }
    return value;
  };

  return validateConfiguration({
    latestVersion: required("BKE_AGENT_UPDATE_LATEST_VERSION"),
    minimumSupportedVersion: required("BKE_AGENT_UPDATE_MINIMUM_SUPPORTED_VERSION"),
    revision: integer("BKE_AGENT_UPDATE_REVISION"),
    signingKeyId: required("BKE_AGENT_UPDATE_SIGNING_KEY_ID"),
    signingPrivateKey: required("BKE_AGENT_UPDATE_SIGNING_PRIVATE_KEY"),
    publishedAt: required("BKE_AGENT_UPDATE_PUBLISHED_AT"),
    artifacts: {
      x86_64: {
        sha256: required("BKE_AGENT_UPDATE_WINDOWS_X64_SHA256"),
        size: integer("BKE_AGENT_UPDATE_WINDOWS_X64_SIZE"),
      },
      arm64: {
        sha256: required("BKE_AGENT_UPDATE_WINDOWS_ARM64_SHA256"),
        size: integer("BKE_AGENT_UPDATE_WINDOWS_ARM64_SIZE"),
      },
    },
  });
}

export function resolveSignedLicensingAgentUpdate(
  request: LicensingAgentUpdateRequest,
  configuration: LicensingAgentUpdateConfiguration,
  issuedAt: Date = new Date(),
): SignedLicensingAgentUpdatePolicy {
  const currentVersion = request.currentVersion.trim();
  if (!valid(currentVersion)) {
    throw new LicensingAgentUpdateRequestError("version must be a valid semantic version");
  }
  if (request.platform.trim().toLowerCase() !== "windows") {
    throw new LicensingAgentUpdateRequestError("unsupported platform");
  }

  const architecture = normalizeLicensingAgentArchitecture(request.architecture);
  const config = validateConfiguration(configuration);

  if (gt(currentVersion, config.latestVersion)) {
    throw new LicensingAgentUpdateRequestError("installed version is newer than update authority");
  }

  const suffix = architecture === "x86_64" ? "x64" : "arm64";
  const artifact = config.artifacts[architecture];
  const unsigned: UnsignedPolicy = {
    schema: LICENSING_AGENT_UPDATE_SCHEMA,
    product_id: LICENSING_AGENT_PRODUCT_ID,
    current_version: currentVersion,
    latest_version: config.latestVersion,
    minimum_supported_version: config.minimumSupportedVersion,
    channel: LICENSING_AGENT_UPDATE_CHANNEL,
    platform: "windows",
    architecture,
    release_id: `bke-licensing-agent-v${config.latestVersion}`,
    artifact_id: `BKE-Licensing-Agent-${config.latestVersion}-Windows-${suffix}.exe`,
    artifact_sha256: artifact.sha256,
    artifact_size: artifact.size,
    content_type: LICENSING_AGENT_UPDATE_CONTENT_TYPE,
    published_at: new Date(config.publishedAt).toISOString(),
    issued_at: issuedAt.toISOString(),
    revision: config.revision,
    signing_key_id: config.signingKeyId,
    algorithm: LICENSING_AGENT_UPDATE_ALGORITHM,
  };

  const privateKey = parseEd25519PrivateKey(config.signingPrivateKey);
  const canonical = canonicalUnsignedPolicy(unsigned);
  const signature = sign(null, canonical, privateKey);
  if (!verify(null, canonical, createPublicKey(privateKey), signature)) {
    throw new LicensingAgentUpdateConfigurationError("update policy signing self-verification failed");
  }

  return { ...unsigned, signature: signature.toString("base64") };
}

export function canonicalUnsignedPolicy(policy: UnsignedPolicy): Buffer {
  const entries = Object.entries(policy).sort(([left], [right]) => left.localeCompare(right));
  return Buffer.from(JSON.stringify(Object.fromEntries(entries)), "utf8");
}

function validateConfiguration(
  configuration: LicensingAgentUpdateConfiguration,
): LicensingAgentUpdateConfiguration {
  if (!valid(configuration.latestVersion)) {
    throw new LicensingAgentUpdateConfigurationError("latest version must be valid semantic version");
  }
  if (!valid(configuration.minimumSupportedVersion)) {
    throw new LicensingAgentUpdateConfigurationError("minimum supported version must be valid semantic version");
  }
  if (gt(configuration.minimumSupportedVersion, configuration.latestVersion)) {
    throw new LicensingAgentUpdateConfigurationError("minimum supported version cannot exceed latest version");
  }
  if (!Number.isSafeInteger(configuration.revision) || configuration.revision < 1) {
    throw new LicensingAgentUpdateConfigurationError("revision must be a positive integer");
  }
  if (!SAFE_KEY_ID.test(configuration.signingKeyId)) {
    throw new LicensingAgentUpdateConfigurationError("signing key id is malformed");
  }
  const published = new Date(configuration.publishedAt);
  if (Number.isNaN(published.valueOf())) {
    throw new LicensingAgentUpdateConfigurationError("published_at is malformed");
  }

  for (const architecture of ["x86_64", "arm64"] as const) {
    const artifact = configuration.artifacts[architecture];
    if (!SHA256.test(artifact.sha256)) {
      throw new LicensingAgentUpdateConfigurationError(`${architecture} artifact SHA-256 is malformed`);
    }
    if (!Number.isSafeInteger(artifact.size) || artifact.size < 2 || artifact.size > MAX_INSTALLER_BYTES) {
      throw new LicensingAgentUpdateConfigurationError(`${architecture} artifact size is invalid`);
    }
  }

  parseEd25519PrivateKey(configuration.signingPrivateKey);
  return configuration;
}

function parseEd25519PrivateKey(value: string): KeyObject {
  try {
    const decoded = value.includes("BEGIN") ? value : Buffer.from(value, "base64").toString("utf8");
    const key = createPrivateKey(decoded);
    if (key.asymmetricKeyType !== "ed25519") {
      throw new Error("not Ed25519");
    }
    return key;
  } catch (error) {
    throw new LicensingAgentUpdateConfigurationError(
      `update signing private key is invalid: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

export function updateRequired(policy: SignedLicensingAgentUpdatePolicy) {
  return lt(policy.current_version, policy.minimum_supported_version);
}

export function updateAvailable(policy: SignedLicensingAgentUpdatePolicy) {
  return gt(policy.latest_version, policy.current_version);
}
