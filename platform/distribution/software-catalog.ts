import { gt, valid } from "semver";

export const BKE_SOFTWARE_CATALOG_REPOSITORY = "jan2xo/bke-software-catalog";
export const BKE_LICENSING_AGENT_PRODUCT_ID = "bke-licensing-agent";

const DEFAULT_LATEST_VERSION = "1.0.0";
const DEFAULT_WINDOWS_X64_URL =
  "https://github.com/jan2xo/bke-software-catalog/releases/download/bke-licensing-agent-v1.0.0/BKE-Licensing-Agent-1.0.0-Windows-x64.exe";
const DEFAULT_RELEASE_NOTES = "Stable BKE Licensing Agent 1.0.0";

export type LicensingAgentUpdateRequest = {
  currentVersion: string;
  platform: string;
  architecture: string;
};

export type LicensingAgentUpdateResponse = {
  productId: typeof BKE_LICENSING_AGENT_PRODUCT_ID;
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  downloadUrl: string | null;
  releaseNotes: string | null;
  required: boolean;
  source: "bke-software-catalog";
};

export class LicensingAgentUpdateRequestError extends Error {}
export class LicensingAgentUpdateConfigurationError extends Error {}

function normalizeArchitecture(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (["x64", "amd64", "x86_64"].includes(normalized)) return "x86_64";
  return normalized;
}

function validateCatalogDownloadUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new LicensingAgentUpdateConfigurationError(
      "BKE_LICENSING_AGENT_WINDOWS_X64_URL must be a valid URL",
    );
  }

  const expectedPrefix = `/${BKE_SOFTWARE_CATALOG_REPOSITORY}/releases/download/`;
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    !url.pathname.startsWith(expectedPrefix)
  ) {
    throw new LicensingAgentUpdateConfigurationError(
      `Licensing Agent downloads must come from https://github.com/${BKE_SOFTWARE_CATALOG_REPOSITORY}/releases/download/...`,
    );
  }
  return url.toString();
}

export function resolveLicensingAgentUpdate(
  request: LicensingAgentUpdateRequest,
  environment: NodeJS.ProcessEnv = process.env,
): LicensingAgentUpdateResponse {
  const currentVersion = request.currentVersion.trim();
  if (!valid(currentVersion)) {
    throw new LicensingAgentUpdateRequestError("version must be a valid semantic version");
  }
  if (request.platform.trim().toLowerCase() !== "windows") {
    throw new LicensingAgentUpdateRequestError("unsupported platform");
  }
  if (normalizeArchitecture(request.architecture) !== "x86_64") {
    throw new LicensingAgentUpdateRequestError("unsupported architecture");
  }

  const latestVersion =
    environment.BKE_LICENSING_AGENT_LATEST_VERSION?.trim() || DEFAULT_LATEST_VERSION;
  if (!valid(latestVersion)) {
    throw new LicensingAgentUpdateConfigurationError(
      "BKE_LICENSING_AGENT_LATEST_VERSION must be a valid semantic version",
    );
  }

  const downloadUrl = validateCatalogDownloadUrl(
    environment.BKE_LICENSING_AGENT_WINDOWS_X64_URL?.trim() || DEFAULT_WINDOWS_X64_URL,
  );
  const updateAvailable = gt(latestVersion, currentVersion);

  return {
    productId: BKE_LICENSING_AGENT_PRODUCT_ID,
    currentVersion,
    latestVersion,
    updateAvailable,
    downloadUrl: updateAvailable ? downloadUrl : null,
    releaseNotes:
      environment.BKE_LICENSING_AGENT_RELEASE_NOTES?.trim() || DEFAULT_RELEASE_NOTES,
    required:
      environment.BKE_LICENSING_AGENT_UPDATE_REQUIRED?.trim().toLowerCase() === "true",
    source: "bke-software-catalog",
  };
}
