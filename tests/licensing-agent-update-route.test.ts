import { generateKeyPairSync } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/licensing-agent/update/route";

const keys = [
  "BKE_AGENT_UPDATE_LATEST_VERSION",
  "BKE_AGENT_UPDATE_MINIMUM_SUPPORTED_VERSION",
  "BKE_AGENT_UPDATE_REVISION",
  "BKE_AGENT_UPDATE_SIGNING_KEY_ID",
  "BKE_AGENT_UPDATE_SIGNING_PRIVATE_KEY",
  "BKE_AGENT_UPDATE_PUBLISHED_AT",
  "BKE_AGENT_UPDATE_WINDOWS_X64_SHA256",
  "BKE_AGENT_UPDATE_WINDOWS_X64_SIZE",
  "BKE_AGENT_UPDATE_WINDOWS_ARM64_SHA256",
  "BKE_AGENT_UPDATE_WINDOWS_ARM64_SIZE",
] as const;

const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of keys) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function configureAuthority() {
  const { privateKey } = generateKeyPairSync("ed25519");
  Object.assign(process.env, {
    BKE_AGENT_UPDATE_LATEST_VERSION: "2.0.1-phase9-cert.1",
    BKE_AGENT_UPDATE_MINIMUM_SUPPORTED_VERSION: "2.0.0",
    BKE_AGENT_UPDATE_REVISION: "7",
    BKE_AGENT_UPDATE_SIGNING_KEY_ID: "phase9-route-v1",
    BKE_AGENT_UPDATE_SIGNING_PRIVATE_KEY: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    BKE_AGENT_UPDATE_PUBLISHED_AT: "2026-09-19T00:00:00Z",
    BKE_AGENT_UPDATE_WINDOWS_X64_SHA256: "a".repeat(64),
    BKE_AGENT_UPDATE_WINDOWS_X64_SIZE: "111",
    BKE_AGENT_UPDATE_WINDOWS_ARM64_SHA256: "b".repeat(64),
    BKE_AGENT_UPDATE_WINDOWS_ARM64_SIZE: "222",
  });
}

describe("GET /api/licensing-agent/update", () => {
  it("returns the exact signed ARM64 policy without an arbitrary download URL", async () => {
    configureAuthority();
    const response = GET(new NextRequest(
      "http://localhost/api/licensing-agent/update?version=2.0.0&platform=windows&architecture=arm64",
    ));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toMatchObject({
      schema: "bke.update-policy.v1",
      product_id: "bke-licensing-agent",
      current_version: "2.0.0",
      latest_version: "2.0.1-phase9-cert.1",
      architecture: "arm64",
      artifact_id: "BKE-Licensing-Agent-2.0.1-phase9-cert.1-Windows-arm64.exe",
      artifact_sha256: "b".repeat(64),
      artifact_size: 222,
      signing_key_id: "phase9-route-v1",
      algorithm: "Ed25519",
    });
    expect(typeof body.signature).toBe("string");
    expect(body.signature.length).toBeGreaterThan(40);
    expect(body.downloadUrl).toBeUndefined();
    expect(body.signingPrivateKey).toBeUndefined();
  });

  it("returns 400 for an unsupported client request", async () => {
    configureAuthority();
    const response = GET(new NextRequest(
      "http://localhost/api/licensing-agent/update?version=2.0.0&platform=windows&architecture=x86",
    ));
    expect(response.status).toBe(400);
  });

  it("returns 503 instead of fabricating authority when signing config is absent", async () => {
    for (const key of keys) delete process.env[key];
    const response = GET(new NextRequest(
      "http://localhost/api/licensing-agent/update?version=2.0.0&platform=windows&architecture=x86_64",
    ));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "licensing_agent_update_unavailable" });
  });
});
