import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  LICENSING_AGENT_UPDATE_SCHEMA,
  LicensingAgentUpdateConfigurationError,
  LicensingAgentUpdateRequestError,
  canonicalUnsignedPolicy,
  licensingAgentUpdateConfigurationFromEnvironment,
  resolveSignedLicensingAgentUpdate,
  updateAvailable,
  updateRequired,
  type LicensingAgentUpdateConfiguration,
  type SignedLicensingAgentUpdatePolicy,
} from "@/v2/platform/distribution/licensing-agent-update-authority";

function fixture(): { config: LicensingAgentUpdateConfiguration; publicKey: ReturnType<typeof generateKeyPairSync>["publicKey"] } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    publicKey,
    config: {
      latestVersion: "2.0.1-phase9-cert.1",
      minimumSupportedVersion: "2.0.0",
      revision: 9,
      signingKeyId: "phase9-test-v1",
      signingPrivateKey: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      publishedAt: "2026-09-19T00:00:00Z",
      artifacts: {
        x86_64: { sha256: "a".repeat(64), size: 123456 },
        arm64: { sha256: "b".repeat(64), size: 234567 },
      },
    },
  };
}

function unsigned(policy: SignedLicensingAgentUpdatePolicy) {
  const { signature: _signature, ...rest } = policy;
  return rest;
}

describe("V2 Licensing Agent signed update authority", () => {
  it("signs an exact x64 policy that independently verifies", () => {
    const { config, publicKey } = fixture();
    const policy = resolveSignedLicensingAgentUpdate(
      { currentVersion: "2.0.0", platform: "windows", architecture: "x86_64" },
      config,
      new Date("2026-09-19T00:10:00Z"),
    );

    expect(policy).toMatchObject({
      schema: LICENSING_AGENT_UPDATE_SCHEMA,
      product_id: "bke-licensing-agent",
      current_version: "2.0.0",
      latest_version: "2.0.1-phase9-cert.1",
      minimum_supported_version: "2.0.0",
      channel: "stable",
      platform: "windows",
      architecture: "x86_64",
      release_id: "bke-licensing-agent-v2.0.1-phase9-cert.1",
      artifact_id: "BKE-Licensing-Agent-2.0.1-phase9-cert.1-Windows-x64.exe",
      artifact_sha256: "a".repeat(64),
      artifact_size: 123456,
      content_type: "application/vnd.microsoft.portable-executable",
      revision: 9,
      signing_key_id: "phase9-test-v1",
      algorithm: "Ed25519",
    });
    expect(updateAvailable(policy)).toBe(true);
    expect(updateRequired(policy)).toBe(false);
    expect(
      verify(
        null,
        canonicalUnsignedPolicy(unsigned(policy)),
        publicKey,
        Buffer.from(policy.signature, "base64"),
      ),
    ).toBe(true);
  });

  it("selects the signed native ARM64 asset contract", () => {
    const { config } = fixture();
    const policy = resolveSignedLicensingAgentUpdate(
      { currentVersion: "1.9.9", platform: "WINDOWS", architecture: "arm64" },
      config,
      new Date("2026-09-19T00:10:00Z"),
    );
    expect(policy.architecture).toBe("arm64");
    expect(policy.artifact_id).toBe("BKE-Licensing-Agent-2.0.1-phase9-cert.1-Windows-arm64.exe");
    expect(policy.artifact_sha256).toBe("b".repeat(64));
    expect(policy.artifact_size).toBe(234567);
    expect(updateRequired(policy)).toBe(true);
  });

  it("normalizes supported x64 aliases without accepting other architectures", () => {
    const { config } = fixture();
    for (const architecture of ["x64", "amd64", "x86_64"]) {
      expect(
        resolveSignedLicensingAgentUpdate(
          { currentVersion: "2.0.0", platform: "windows", architecture },
          config,
        ).architecture,
      ).toBe("x86_64");
    }
    expect(() =>
      resolveSignedLicensingAgentUpdate(
        { currentVersion: "2.0.0", platform: "windows", architecture: "x86" },
        config,
      ),
    ).toThrow(LicensingAgentUpdateRequestError);
  });

  it("rejects malformed requests and version rollback decisions", () => {
    const { config } = fixture();
    expect(() =>
      resolveSignedLicensingAgentUpdate(
        { currentVersion: "nope", platform: "windows", architecture: "x64" },
        config,
      ),
    ).toThrow(LicensingAgentUpdateRequestError);
    expect(() =>
      resolveSignedLicensingAgentUpdate(
        { currentVersion: "2.1.0", platform: "windows", architecture: "x64" },
        config,
      ),
    ).toThrow(/newer than update authority/);
  });

  it("fails closed on incomplete or malformed signing configuration", () => {
    const { config } = fixture();
    expect(() =>
      resolveSignedLicensingAgentUpdate(
        { currentVersion: "2.0.0", platform: "windows", architecture: "x64" },
        { ...config, signingPrivateKey: "not-a-private-key" },
      ),
    ).toThrow(LicensingAgentUpdateConfigurationError);
    expect(() =>
      resolveSignedLicensingAgentUpdate(
        { currentVersion: "2.0.0", platform: "windows", architecture: "x64" },
        { ...config, artifacts: { ...config.artifacts, x86_64: { sha256: "bad", size: 1 } } },
      ),
    ).toThrow(LicensingAgentUpdateConfigurationError);
  });

  it("loads the exact production-shaped environment contract", () => {
    const { config } = fixture();
    const loaded = licensingAgentUpdateConfigurationFromEnvironment({
      BKE_AGENT_UPDATE_LATEST_VERSION: config.latestVersion,
      BKE_AGENT_UPDATE_MINIMUM_SUPPORTED_VERSION: config.minimumSupportedVersion,
      BKE_AGENT_UPDATE_REVISION: String(config.revision),
      BKE_AGENT_UPDATE_SIGNING_KEY_ID: config.signingKeyId,
      BKE_AGENT_UPDATE_SIGNING_PRIVATE_KEY: config.signingPrivateKey,
      BKE_AGENT_UPDATE_PUBLISHED_AT: config.publishedAt,
      BKE_AGENT_UPDATE_WINDOWS_X64_SHA256: config.artifacts.x86_64.sha256,
      BKE_AGENT_UPDATE_WINDOWS_X64_SIZE: String(config.artifacts.x86_64.size),
      BKE_AGENT_UPDATE_WINDOWS_ARM64_SHA256: config.artifacts.arm64.sha256,
      BKE_AGENT_UPDATE_WINDOWS_ARM64_SIZE: String(config.artifacts.arm64.size),
    });
    expect(loaded).toMatchObject({
      latestVersion: config.latestVersion,
      revision: 9,
      signingKeyId: "phase9-test-v1",
    });
  });
});
