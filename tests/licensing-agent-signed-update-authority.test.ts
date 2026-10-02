import {
  generateKeyPairSync,
  verify,
} from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  LICENSING_AGENT_UPDATE_SCHEMA,
  canonicalUnsignedPolicy,
  inspectLicensingAgentGitHubRelease,
  rawEd25519PublicKeyFromPrivate,
  signLicensingAgentUpdatePolicy,
  updateAvailable,
  updateRequired,
} from "@/platform/distribution/licensing-agent-update-contract";

function signingFixture() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({
    format: "pem",
    type: "pkcs8",
  }).toString();
  return {
    publicKey,
    privatePem,
    rawPublic: rawEd25519PublicKeyFromPrivate(privatePem).toString("base64"),
  };
}

describe("Licensing Agent signed self-update authority contract", () => {
  it("signs the exact bke.update-policy.v1 contract consumed by the Agent", () => {
    const keys = signingFixture();
    const policy = signLicensingAgentUpdatePolicy(
      {
        currentVersion: "2.0.1",
        platform: "windows",
        architecture: "x64",
      },
      {
        latestVersion: "2.0.2",
        minimumSupportedVersion: "2.0.0",
        revision: 22,
        releaseTag: "bke-licensing-agent-v2.0.2",
        publishedAt: new Date("2026-10-02T00:00:00Z"),
        artifact: {
          architecture: "x86_64",
          artifactId: "BKE-Licensing-Agent-2.0.2-Windows-x64.exe",
          sha256: "a".repeat(64),
          size: 123456,
        },
        signingKeyId: "agent-update-test-v1",
        signingPublicKey: keys.rawPublic,
        signingPrivateKey: keys.privatePem,
      },
      new Date("2026-10-02T00:05:00Z"),
    );

    expect(policy).toMatchObject({
      schema: LICENSING_AGENT_UPDATE_SCHEMA,
      product_id: "bke-licensing-agent",
      current_version: "2.0.1",
      latest_version: "2.0.2",
      minimum_supported_version: "2.0.0",
      channel: "stable",
      platform: "windows",
      architecture: "x86_64",
      release_id: "bke-licensing-agent-v2.0.2",
      artifact_id: "BKE-Licensing-Agent-2.0.2-Windows-x64.exe",
      artifact_sha256: "a".repeat(64),
      artifact_size: 123456,
      content_type: "application/vnd.microsoft.portable-executable",
      revision: 22,
      signing_key_id: "agent-update-test-v1",
      algorithm: "Ed25519",
    });
    const { signature, ...unsigned } = policy;
    expect(
      verify(
        null,
        canonicalUnsignedPolicy(unsigned),
        keys.publicKey,
        Buffer.from(signature, "base64"),
      ),
    ).toBe(true);
    expect(updateAvailable(policy)).toBe(true);
    expect(updateRequired(policy)).toBe(false);
    expect(policy).not.toHaveProperty("downloadUrl");
    expect(policy).not.toHaveProperty("download_url");
  });

  it("derives and verifies Agent release assets from GitHub authority", async () => {
    const fetcher = vi.fn(async () => new Response(
      JSON.stringify({
        tag_name: "bke-licensing-agent-v2.0.2",
        draft: false,
        prerelease: true,
        published_at: "2026-10-02T00:00:00Z",
        assets: [
          {
            name: "BKE-Licensing-Agent-2.0.2-Windows-x64.exe",
            size: 100,
            digest: `sha256:${"a".repeat(64)}`,
          },
          {
            name: "BKE-Licensing-Agent-2.0.2-Windows-arm64.exe",
            size: 200,
            digest: `sha256:${"b".repeat(64)}`,
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));

    const release = await inspectLicensingAgentGitHubRelease(
      "2.0.2",
      "PREPRODUCTION",
      fetcher as typeof fetch,
    );
    expect(release.releaseTag).toBe("bke-licensing-agent-v2.0.2");
    expect(release.artifacts).toEqual([
      {
        architecture: "x86_64",
        artifactId: "BKE-Licensing-Agent-2.0.2-Windows-x64.exe",
        sha256: "a".repeat(64),
        size: 100,
      },
      {
        architecture: "arm64",
        artifactId: "BKE-Licensing-Agent-2.0.2-Windows-arm64.exe",
        sha256: "b".repeat(64),
        size: 200,
      },
    ]);
  });

  it("fails closed on release audience and digest drift", async () => {
    const stableFetcher = vi.fn(async () => new Response(
      JSON.stringify({
        tag_name: "bke-licensing-agent-v2.0.2",
        draft: false,
        prerelease: false,
        published_at: "2026-10-02T00:00:00Z",
        assets: [{
          name: "BKE-Licensing-Agent-2.0.2-Windows-x64.exe",
          size: 100,
          digest: `sha256:${"a".repeat(64)}`,
        }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    await expect(
      inspectLicensingAgentGitHubRelease(
        "2.0.2",
        "PREPRODUCTION",
        stableFetcher as typeof fetch,
      ),
    ).rejects.toThrow(/audience/);

    const badDigestFetcher = vi.fn(async () => new Response(
      JSON.stringify({
        tag_name: "bke-licensing-agent-v2.0.2",
        draft: false,
        prerelease: true,
        published_at: "2026-10-02T00:00:00Z",
        assets: [{
          name: "BKE-Licensing-Agent-2.0.2-Windows-x64.exe",
          size: 100,
          digest: "sha256:bad",
        }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    await expect(
      inspectLicensingAgentGitHubRelease(
        "2.0.2",
        "PREPRODUCTION",
        badDigestFetcher as typeof fetch,
      ),
    ).rejects.toThrow(/metadata/);
  });
});
