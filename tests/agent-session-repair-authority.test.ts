import {
  generateKeyPairSync,
  verify,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AGENT_ACCOUNT_REPAIR_POLICY_TTL_SECONDS,
  canonicalAgentAccountRepairPolicy,
  signAgentAccountRepairPolicy,
} from "@/apps/web/agent-sessions/repair-policy";

describe("Agent account-session repair authority", () => {
  it("issues a short-lived same-version GitHub repair policy", () => {
    const keys = generateKeyPairSync("ed25519");
    const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
    const issuedAt = new Date("2026-09-24T00:00:00.000Z");

    const policy = signAgentAccountRepairPolicy(
      {
        productId: "bke-render-dock",
        repairVersion: "1.0.2",
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
    expect(policy.schema).toBe("bke.repair-policy.v1");
    expect(policy.source_authority).toBe("GITHUB_RELEASES");
    expect(policy.repair_version).toBe("1.0.2");
    expect(policy.tag).toBe("v1.0.2");
    expect(policy).not.toHaveProperty("target_version");
    expect(policy).not.toHaveProperty("latest_version");
    expect(policy).not.toHaveProperty("artifact_sha256");
    expect(policy).not.toHaveProperty("artifact_size");
    expect(policy).not.toHaveProperty("download_url");
    expect(AGENT_ACCOUNT_REPAIR_POLICY_TTL_SECONDS).toBe(300);
    expect(
      new Date(policy.expires_at).getTime() - new Date(policy.issued_at).getTime(),
    ).toBe(AGENT_ACCOUNT_REPAIR_POLICY_TTL_SECONDS * 1000);
    expect(
      verify(
        null,
        canonicalAgentAccountRepairPolicy(unsigned),
        keys.publicKey,
        Buffer.from(signature, "base64"),
      ),
    ).toBe(true);
  });

  it("keeps Repair distinct from Update and legacy lease authority", () => {
    const route = readFileSync(
      "app/api/agent-sessions/repair/standalone/route.ts",
      "utf8",
    );

    expect(route).toContain("authenticateAgentAccessToken");
    expect(route).toContain("readAgentSoftwareCatalog");
    expect(route).toContain("issueAgentAccountRepairPolicy");
    expect(route).toContain("githubReleaseRepository");
    expect(route).toContain('channel: z.literal("stable")');
    expect(route).not.toContain("issueAgentAccountUpdatePolicy");
    expect(route).not.toContain("verified_licenses");
    expect(route).not.toContain("licenseKey");
    expect(route).not.toContain("leasePayload");
  });

  it("fails closed for malformed repair authority", () => {
    const keys = generateKeyPairSync("ed25519");
    const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
    const key = {
      keyId: "production-ed25519-v1",
      algorithm: "Ed25519",
      publicKey,
      privateKey,
    };

    expect(() => signAgentAccountRepairPolicy({
      productId: "bke-render-dock",
      repairVersion: "not-a-version",
      platform: "windows",
      architecture: "x64",
      repository: "jan2xo/BKE_RENDER_DOCK",
    }, key)).toThrow("REPAIR_POLICY_VERSION_INVALID");

    expect(() => signAgentAccountRepairPolicy({
      productId: "bke-render-dock",
      repairVersion: "1.0.2",
      platform: "windows",
      architecture: "x64",
      repository: "https://github.com/jan2xo/BKE_RENDER_DOCK",
    }, key)).toThrow("REPAIR_POLICY_REPOSITORY_INVALID");
  });
});
