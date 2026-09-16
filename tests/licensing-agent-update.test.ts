import { describe, expect, it } from "vitest";
import {
  LicensingAgentUpdateConfigurationError,
  LicensingAgentUpdateRequestError,
  resolveLicensingAgentUpdate,
} from "@/v2/platform/distribution/software-catalog";

const environment = {
  BKE_LICENSING_AGENT_LATEST_VERSION: "1.0.0",
  BKE_LICENSING_AGENT_WINDOWS_X64_URL:
    "https://github.com/jan2xo/bke-software-catalog/releases/download/bke-licensing-agent-v1.0.0/BKE-Licensing-Agent-1.0.0-Windows-x64.exe",
  BKE_LICENSING_AGENT_RELEASE_NOTES: "Stable Licensing Agent 1.0.0",
  BKE_LICENSING_AGENT_UPDATE_REQUIRED: "false",
};

describe("Licensing Agent software catalog update resolver", () => {
  it("offers stable 1.0.0 to the 0.0.0 update probe", () => {
    expect(
      resolveLicensingAgentUpdate(
        { currentVersion: "0.0.0", platform: "windows", architecture: "x86_64" },
        environment,
      ),
    ).toEqual({
      productId: "bke-licensing-agent",
      currentVersion: "0.0.0",
      latestVersion: "1.0.0",
      updateAvailable: true,
      downloadUrl:
        "https://github.com/jan2xo/bke-software-catalog/releases/download/bke-licensing-agent-v1.0.0/BKE-Licensing-Agent-1.0.0-Windows-x64.exe",
      releaseNotes: "Stable Licensing Agent 1.0.0",
      required: false,
      source: "bke-software-catalog",
    });
  });

  it("reports no update when the Agent is already current", () => {
    const result = resolveLicensingAgentUpdate(
      { currentVersion: "1.0.0", platform: "windows", architecture: "x64" },
      environment,
    );
    expect(result.updateAvailable).toBe(false);
    expect(result.downloadUrl).toBeNull();
  });

  it("rejects invalid client versions and unsupported targets", () => {
    expect(() =>
      resolveLicensingAgentUpdate(
        { currentVersion: "not-a-version", platform: "windows", architecture: "x64" },
        environment,
      ),
    ).toThrow(LicensingAgentUpdateRequestError);

    expect(() =>
      resolveLicensingAgentUpdate(
        { currentVersion: "0.0.0", platform: "linux", architecture: "x64" },
        environment,
      ),
    ).toThrow(LicensingAgentUpdateRequestError);
  });

  it("accepts only release assets from the BKE software catalog", () => {
    expect(() =>
      resolveLicensingAgentUpdate(
        { currentVersion: "0.0.0", platform: "windows", architecture: "x64" },
        {
          ...environment,
          BKE_LICENSING_AGENT_WINDOWS_X64_URL:
            "https://example.com/BKE-Licensing-Agent-1.0.0-Windows-x64.exe",
        },
      ),
    ).toThrow(LicensingAgentUpdateConfigurationError);
  });
});
