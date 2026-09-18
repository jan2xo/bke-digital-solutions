import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "bke-agent-authority-bundle-"));
  roots.push(root);

  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const publicJwk = publicKey.export({ format: "jwk" });
  if (!publicJwk.x) throw new Error("missing Ed25519 public x");

  const privatePath = join(root, "private.pem");
  const publicPath = join(root, "public.json");
  const manifestPath = join(root, "manifest.json");
  const outputPath = join(root, "bundle.json");

  writeFileSync(privatePath, privatePem);
  writeFileSync(publicPath, JSON.stringify({
    schema: "bke.update-authority-key.v1",
    key_id: "bke-agent-update-prod-v1",
    algorithm: "Ed25519",
    public_key: Buffer.from(publicJwk.x, "base64url").toString("base64"),
  }));
  writeFileSync(manifestPath, JSON.stringify({
    schema: "bke.production-release-manifest.v1",
    status: "SIGNED_VERIFIED",
    version: "2.0.0",
    update_authority_key_id: "bke-agent-update-prod-v1",
    installers: {
      x64: {
        sha256: "a".repeat(64),
        bytes: 111111,
        authenticode_status: "Valid",
      },
      arm64: {
        sha256: "b".repeat(64),
        bytes: 222222,
        authenticode_status: "Valid",
      },
    },
  }));

  return { root, privatePath, publicPath, manifestPath, outputPath };
}

function run(args: string[]) {
  return spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["tsx", "scripts/build-production-agent-authority-bundle.ts", ...args],
    { encoding: "utf8" },
  );
}

describe("production Agent authority bundle builder", () => {
  it("creates an undeployed V2 authority bundle from exact signed release evidence", () => {
    const f = fixture();
    const result = run([
      "--authorization", "AUTHORIZE_PRODUCTION_AUTHORITY_BUNDLE",
      "--release-manifest", f.manifestPath,
      "--private-key", f.privatePath,
      "--public-key", f.publicPath,
      "--output", f.outputPath,
      "--revision", "1",
      "--minimum-supported-version", "2.0.0",
      "--published-at", "2026-09-19T02:00:00+08:00",
    ]);

    expect(result.status).toBe(0);
    const bundle = JSON.parse(readFileSync(f.outputPath, "utf8"));
    expect(bundle).toMatchObject({
      schema: "bke.production-agent-authority-bundle.v1",
      version: "2.0.0",
      production_key_id: "bke-agent-update-prod-v1",
      revision: 1,
      deployment_authorized: false,
      catalog_publication_authorized: false,
      environment: {
        BKE_AGENT_UPDATE_LATEST_VERSION: "2.0.0",
        BKE_AGENT_UPDATE_MINIMUM_SUPPORTED_VERSION: "2.0.0",
        BKE_AGENT_UPDATE_REVISION: "1",
        BKE_AGENT_UPDATE_SIGNING_KEY_ID: "bke-agent-update-prod-v1",
        BKE_AGENT_UPDATE_WINDOWS_X64_SHA256: "a".repeat(64),
        BKE_AGENT_UPDATE_WINDOWS_X64_SIZE: "111111",
        BKE_AGENT_UPDATE_WINDOWS_ARM64_SHA256: "b".repeat(64),
        BKE_AGENT_UPDATE_WINDOWS_ARM64_SIZE: "222222",
      },
    });
    expect(bundle.environment.BKE_AGENT_UPDATE_SIGNING_PRIVATE_KEY).toBeTruthy();
    expect(result.stdout).not.toContain(privatePemFromFile(f.privatePath));
  });

  it("rejects mismatched public/private production authority keys", () => {
    const f = fixture();
    const other = generateKeyPairSync("ed25519").publicKey.export({ format: "jwk" });
    if (!other.x) throw new Error("missing alternate Ed25519 public x");
    writeFileSync(f.publicPath, JSON.stringify({
      schema: "bke.update-authority-key.v1",
      key_id: "bke-agent-update-prod-v1",
      algorithm: "Ed25519",
      public_key: Buffer.from(other.x, "base64url").toString("base64"),
    }));

    const result = run([
      "--authorization", "AUTHORIZE_PRODUCTION_AUTHORITY_BUNDLE",
      "--release-manifest", f.manifestPath,
      "--private-key", f.privatePath,
      "--public-key", f.publicPath,
      "--output", f.outputPath,
      "--revision", "1",
      "--minimum-supported-version", "2.0.0",
      "--published-at", "2026-09-19T02:00:00+08:00",
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toContain("do not match");
  });
});

function privatePemFromFile(path: string) {
  return readFileSync(path, "utf8").trim();
}
