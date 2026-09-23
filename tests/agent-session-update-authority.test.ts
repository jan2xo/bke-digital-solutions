import {
  generateKeyPairSync,
  verify,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AGENT_ACCOUNT_UPDATE_POLICY_TTL_SECONDS,
  canonicalAgentAccountUpdatePolicy,
  signAgentAccountUpdatePolicy,
} from "@/apps/web/agent-sessions/update-policy";

describe("Agent account-session update authority", () => {
  it("issues a short-lived GitHub-authority policy that matches Agent canonicalization", () => {
    const keys = generateKeyPairSync("ed25519");
    const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
    const issuedAt = new Date("2026-09-24T00:00:00.000Z");

    const policy = signAgentAccountUpdatePolicy(
      {
        productId: "bke-render-dock",
        currentVersion: "1.0.1",
        targetVersion: "1.0.2",
        platform: "windows",
        architecture: "arm64",
        repository: "jan2xo/BKE_RENDER_DOCK",
      },
      {
        keyId: "production-ed25519-v1",
        algorithm: "Ed25519",
        publicKey,
        privateKey,
      },
      issuedAt,
    );

    const { signature, ...unsigned } = policy;
    expect(policy.schema).toBe("bke.update-policy.v2");
    expect(policy.source_authority).toBe("GITHUB_RELEASES");
    expect(policy.repository).toBe("jan2xo/BKE_RENDER_DOCK");
    expect(policy.tag).toBe("v1.0.2");
    expect(policy.target_version).toBe("1.0.2");
    expect(policy).not.toHaveProperty("artifact_sha256");
    expect(policy).not.toHaveProperty("artifact_size");
    expect(policy).not.toHaveProperty("download_url");
    expect(AGENT_ACCOUNT_UPDATE_POLICY_TTL_SECONDS).toBe(300);
    expect(
      new Date(policy.expires_at).getTime() - new Date(policy.issued_at).getTime(),
    ).toBe(AGENT_ACCOUNT_UPDATE_POLICY_TTL_SECONDS * 1000);
    expect(
      verify(
        null,
        canonicalAgentAccountUpdatePolicy(unsigned),
        keys.publicKey,
        Buffer.from(signature, "base64"),
      ),
    ).toBe(true);
  });

  it("keeps authorization on Agent account sessions instead of legacy license leases", () => {
    const route = readFileSync(
      "app/api/agent-sessions/update/standalone/route.ts",
      "utf8",
    );

    expect(route).toContain("authenticateAgentAccessToken");
    expect(route).toContain("readAgentSoftwareCatalog");
    expect(route).toContain("issueAgentAccountUpdatePolicy");
    expect(route).toContain("update-policy-issuer");
    expect(route).toContain("githubReleaseRepository");
    expect(route).toContain('channel: z.literal("stable")');
    expect(route).not.toContain("verified_licenses");
    expect(route).not.toContain("licenseKey");
    expect(route).not.toContain("leasePayload");
  });

  it("fails closed for malformed update targets", () => {
    const keys = generateKeyPairSync("ed25519");
    const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
    const key = {
      keyId: "production-ed25519-v1",
      algorithm: "Ed25519",
      publicKey,
      privateKey,
    };

    expect(() => signAgentAccountUpdatePolicy({
      productId: "bke-render-dock",
      currentVersion: "1.0.2",
      targetVersion: "1.0.2",
      platform: "windows",
      architecture: "x64",
      repository: "jan2xo/BKE_RENDER_DOCK",
    }, key)).toThrow("UPDATE_POLICY_TARGET_NOT_NEWER");

    expect(() => signAgentAccountUpdatePolicy({
      productId: "bke-render-dock",
      currentVersion: "1.0.1",
      targetVersion: "1.0.2",
      platform: "windows",
      architecture: "x64",
      repository: "https://github.com/jan2xo/BKE_RENDER_DOCK",
    }, key)).toThrow("UPDATE_POLICY_REPOSITORY_INVALID");
  });
});
