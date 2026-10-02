import {
  generateKeyPairSync,
  randomUUID,
  verify,
} from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/licensing-agent/update/route";
import { getPostgresPool } from "@/apps/web/persistence/postgres";
import {
  canonicalUnsignedPolicy,
  rawEd25519PublicKeyFromPrivate,
} from "@/platform/distribution/licensing-agent-update-contract";

const originalDeployment = process.env.DEPLOYMENT_ENV;
const originalKeys = process.env.BKE_AGENT_UPDATE_SIGNING_KEYS;

async function clean() {
  await getPostgresPool().query(
    `TRUNCATE TABLE
       "LicensingAgentUpdateOperation",
       "LicensingAgentUpdateArtifact",
       "LicensingAgentUpdateRelease",
       "LicensingAgentUpdateKey"
     RESTART IDENTITY CASCADE`,
  );
}

async function seedPreproductionAuthority() {
  const keys = generateKeyPairSync("ed25519");
  const privatePem = keys.privateKey.export({
    format: "pem",
    type: "pkcs8",
  }).toString();
  const rawPublic =
    rawEd25519PublicKeyFromPrivate(privatePem).toString("base64");
  process.env.BKE_AGENT_UPDATE_SIGNING_KEYS = JSON.stringify({
    "route-test-v1": privatePem,
  });

  const releaseId = randomUUID();
  await getPostgresPool().query(
    `INSERT INTO "LicensingAgentUpdateKey"
       ("id", "keyId", "algorithm", "publicKey", "privateKeyReference",
        "trustedFromVersion", "status", "createdAt", "activatedAt")
     VALUES ($1, 'route-test-v1', 'Ed25519', $2, 'key:route-test-v1',
             '2.0.0', 'ACTIVE', NOW(), NOW())`,
    [randomUUID(), rawPublic],
  );
  await getPostgresPool().query(
    `INSERT INTO "LicensingAgentUpdateRelease"
       ("id", "version", "minimumSupportedVersion", "revision", "audience",
        "channel", "releaseTag", "publishedAt", "active", "createdAt",
        "updatedAt", "activatedAt")
     VALUES ($1, '2.0.2', '2.0.0', 5, 'PREPRODUCTION', 'stable',
             'bke-licensing-agent-v2.0.2', NOW(), true, NOW(), NOW(), NOW())`,
    [releaseId],
  );
  await getPostgresPool().query(
    `INSERT INTO "LicensingAgentUpdateArtifact"
       ("id", "releaseId", "architecture", "artifactId", "sha256",
        "sizeBytes", "contentType", "createdAt")
     VALUES ($1, $2, 'x86_64',
             'BKE-Licensing-Agent-2.0.2-Windows-x64.exe',
             $3, 321,
             'application/vnd.microsoft.portable-executable', NOW())`,
    [randomUUID(), releaseId, "c".repeat(64)],
  );
  return keys;
}

beforeEach(async () => {
  process.env.DEPLOYMENT_ENV = "test";
  await clean();
});

afterEach(async () => {
  await clean();
  if (originalDeployment === undefined) delete process.env.DEPLOYMENT_ENV;
  else process.env.DEPLOYMENT_ENV = originalDeployment;
  if (originalKeys === undefined) {
    delete process.env.BKE_AGENT_UPDATE_SIGNING_KEYS;
  } else {
    process.env.BKE_AGENT_UPDATE_SIGNING_KEYS = originalKeys;
  }
});

describe("GET /api/licensing-agent/update durable signed authority", () => {
  it("serves a signed policy from active durable PREPRODUCTION state", async () => {
    const keys = await seedPreproductionAuthority();
    const response = await GET(new NextRequest(
      "http://localhost/api/licensing-agent/update?version=2.0.1&platform=windows&architecture=x86_64",
    ));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const policy = await response.json();
    expect(policy).toMatchObject({
      schema: "bke.update-policy.v1",
      product_id: "bke-licensing-agent",
      current_version: "2.0.1",
      latest_version: "2.0.2",
      minimum_supported_version: "2.0.0",
      release_id: "bke-licensing-agent-v2.0.2",
      artifact_id: "BKE-Licensing-Agent-2.0.2-Windows-x64.exe",
      artifact_sha256: "c".repeat(64),
      artifact_size: 321,
      revision: 5,
      signing_key_id: "route-test-v1",
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
    expect(policy).not.toHaveProperty("downloadUrl");
  });

  it("returns 503 instead of fabricating authority with no active release", async () => {
    const response = await GET(new NextRequest(
      "http://localhost/api/licensing-agent/update?version=2.0.1&platform=windows&architecture=x86_64",
    ));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "licensing_agent_update_unavailable",
    });
  });

  it("isolates PRODUCTION from PREPRODUCTION release state", async () => {
    await seedPreproductionAuthority();
    process.env.DEPLOYMENT_ENV = "production";
    const response = await GET(new NextRequest(
      "http://localhost/api/licensing-agent/update?version=2.0.1&platform=windows&architecture=x86_64",
    ));
    expect(response.status).toBe(503);
  });
});
