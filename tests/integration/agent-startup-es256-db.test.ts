import "dotenv/config";

import { createHash, generateKeyPairSync, randomUUID, sign, verify } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/platform/persistence/generated/prisma/client";
import {
  startupEs256Contract,
  verifyStartupEs256AttestationInTransaction,
} from "@/apps/web/agent-sessions/standalone-startup-es256-attestation";
import {
  stageStartupEs256MachineKeyInTransaction,
  activateStartupEs256MachineKeyInTransaction,
  revokeStartupEs256MachineKeyInTransaction,
} from "@/apps/web/agent-sessions/startup-machine-es256-admin";
import { prepareAndSignStandaloneStartupPolicyInTransaction } from
  "@/apps/web/agent-sessions/standalone-startup-policy-issuance";

// Same guarded disposable CORE PostgreSQL as the existing dual-activation and
// v1 startup proof; NEVER runs with local/staging/production database URLs.
const eligible = (() => {
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.NODE_ENV !== "test" ||
      process.env.BKE_PRODUCT_ACTIVATION_DB_PROOF !== "1") return false;
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    return ["localhost", "127.0.0.1"].includes(url.hostname) &&
      url.port === "5432" && url.pathname === "/bke_test";
  } catch { return false; }
})();
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});
const machine = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const ds = generateKeyPairSync("ed25519");
const deviceId = "ci-es256-device-" + randomUUID();
const machineKid = "ci-es256-startup-" + randomUUID();
const dsKid = "ci-es256-policy-" + randomUUID();
const firstAdmin = "ci-es256-first-" + randomUUID();
const secondAdmin = "ci-es256-second-" + randomUUID();
const productId = "ci-es256-" + randomUUID();
const version = "1.0.3";
const imagePath = "C:\\Program Files\\BKE Digital Solutions\\Render Dock\\RENDER DOCK.exe";
const sid = "S-1-5-21-101-202-303-1001";
const publicKeyPem = machine.publicKey.export({ type: "spki", format: "pem" }).toString();
const fingerprint = createHash("sha256").update(
  machine.publicKey.export({ type: "spki", format: "der" })).digest("hex");
const signerKeyset = JSON.stringify({ [dsKid]:
  ds.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
});
const consumedIds: string[] = [];
let productDatabaseId = "";

function candidate() {
  return JSON.stringify({
    schema: startupEs256Contract.candidateSchema,
    kid: machineKid, device_id: deviceId, algorithm: "ES256",
    public_key_pem: publicKeyPem, status: "STAGED",
  });
}
function proof() {
  const start = new Date();
  const attestationId = randomUUID();
  const payload = JSON.stringify({
    schema: startupEs256Contract.payloadSchema, algorithm: "ES256",
    product_id: productId, version, installation_id: randomUUID(),
    image_path: imagePath, image_sha256: "c".repeat(64),
    allowed_user_sid: sid, device_id: deviceId, attestation_id: attestationId,
    issued_at: new Date(start.getTime() - 2000).toISOString(),
    expires_at: new Date(start.getTime() + 90000).toISOString(),
  });
  return {
    attestationId,
    raw: JSON.stringify({
      schema: startupEs256Contract.envelopeSchema,
      kid: machineKid, algorithm: "ES256", payload,
      signature: sign("sha256",
        Buffer.from(startupEs256Contract.signedDomain + payload),
        { key: machine.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64"),
    }),
  };
}

describe.runIf(eligible)(
  "ES256 v2 two-admin startup trust — disposable SQL only (NOT TPM hardware evidence)",
  { concurrent: false }, () => {
    afterAll(async () => {
      await db.$executeRaw`
        DELETE FROM "AgentStartupAttestationReceipt" WHERE "signerKid"=${machineKid}
      `.catch(() => undefined);
      await db.auditLog.deleteMany({ where: {
        targetId: { in: [machineKid, ...consumedIds] },
      } }).catch(() => undefined);
      if (productDatabaseId) await db.product.delete({
        where: { id: productDatabaseId },
      }).catch(() => undefined);
      await db.$executeRaw`
        DELETE FROM "AccountProductLeaseSigningKey" WHERE "kid"=${dsKid}
      `.catch(() => undefined);
      await db.$executeRaw`
        DELETE FROM "AgentStartupAttestationSigningKey" WHERE "kid"=${machineKid}
      `.catch(() => undefined);
      await db.user.deleteMany({
        where: { id: { in: [firstAdmin, secondAdmin] } },
      }).catch(() => undefined);
      await db.$disconnect();
    });

    it("enforces immutable ES256 SQL algorithm, distinct ADMIN activation and public-only registry", async () => {
      await db.user.createMany({ data: [
        { id: firstAdmin, email: "first-" + randomUUID() + "@example.test",
          role: "ADMIN", lifecycleState: "ACTIVE" },
        { id: secondAdmin, email: "second-" + randomUUID() + "@example.test",
          role: "ADMIN", lifecycleState: "ACTIVE" },
      ] });
      const stage = await db.$transaction(tx =>
        stageStartupEs256MachineKeyInTransaction(tx, {
          candidate: candidate(), reviewedFingerprintSha256: fingerprint,
        }, firstAdmin), { isolationLevel: "Serializable" });
      expect(stage).toMatchObject({ kid: machineKid, algorithm: "ES256", status: "STAGED" });

      await expect(db.$executeRaw`
        UPDATE "AgentStartupAttestationSigningKey" SET "algorithm"='Ed25519'
         WHERE "kid"=${machineKid}
      `).rejects.toThrow();
      const row = await db.$queryRaw<Array<{ status: string; algorithm: string;
        stagedBy: string; publicKeyPem: string }>>`
        SELECT "status","algorithm","stagedBy","publicKeyPem"
          FROM "AgentStartupAttestationSigningKey" WHERE "kid"=${machineKid}
      `;
      expect(row).toHaveLength(1);
      expect(row[0]).toMatchObject({ status: "STAGED", algorithm: "ES256",
        stagedBy: firstAdmin, publicKeyPem });
      expect(row[0]!.publicKeyPem).not.toContain("PRIVATE KEY");

      const signed = proof();
      await expect(db.$transaction(tx =>
        activateStartupEs256MachineKeyInTransaction(tx, {
          kid: machineKid, confirmedFingerprintSha256: fingerprint,
          freshSignedInstallProof: signed.raw,
        }, firstAdmin))).rejects.toThrow("STARTUP_ES256_INDEPENDENT_ADMIN_REQUIRED");
      await expect(db.$transaction(tx =>
        verifyStartupEs256AttestationInTransaction(tx, signed.raw)))
        .rejects.toThrow("STARTUP_ES256_UNTRUSTED_AGENT");

      const active = await db.$transaction(tx =>
        activateStartupEs256MachineKeyInTransaction(tx, {
          kid: machineKid, confirmedFingerprintSha256: fingerprint,
          freshSignedInstallProof: signed.raw,
        }, secondAdmin), { isolationLevel: "Serializable" });
      expect(active).toEqual({ kid: machineKid, algorithm: "ES256", status: "ACTIVE" });
      const rows = await db.$queryRaw<Array<{ activatedBy: string;
        activationProofSha256: string; algorithm: string }>>`
        SELECT "activatedBy","activationProofSha256","algorithm"
          FROM "AgentStartupAttestationSigningKey" WHERE "kid"=${machineKid}
      `;
      expect(rows[0]!.activatedBy).toBe(secondAdmin);
      expect(rows[0]!.algorithm).toBe("ES256");
      expect(rows[0]!.activationProofSha256).toBe(
        createHash("sha256").update(signed.raw).digest("hex"));
    });

    it("issues signed SQL-only LICENSE_KEY policy with ES256 signer; prevents replay and persists audit", async () => {
      await db.$executeRaw`
        INSERT INTO "AccountProductLeaseSigningKey"
          ("kid","publicKeyPem","privateKeyReference","status","activatedAt")
        VALUES (${dsKid},
          ${ds.publicKey.export({ type: "spki", format: "pem" }).toString()},
          ${"keyset:" + dsKid},'ACTIVE',now())
      `;
      const product = await db.product.create({ data: {
        slug: productId, productId,
        name: "Disposable ES256 Startup Mode",
        summary: "Local preproduction ES256 verification, no customer entitlement",
        description: "No TPM hardware or installed customer executable used",
        type: "SOFTWARE", active: false,
        launcherExecutionType: "STANDALONE",
        licenseType: "Commercial",
      } });
      productDatabaseId = product.id;
      await db.$executeRaw`
        UPDATE "ProductActivationPolicy" SET "activationMode"='LICENSE_KEY'
         WHERE "productId"=${product.id}
      `;
      await db.product.update({ where: { id: product.id },
        data: { active: true, publishedAt: new Date() } });
      await db.productVersion.create({ data: {
        productId: product.id, version, operatingSystem: "windows",
        architecture: "x64", lifecycle: "STABLE", active: true,
        publishedAt: new Date(),
      } });
      const signed = proof();
      consumedIds.push(signed.attestationId);
      const output = await db.$transaction(tx =>
        prepareAndSignStandaloneStartupPolicyInTransaction(tx, {
          signedAgentInstallAttestation: signed.raw,
          keyset: signerKeyset,
        }), { isolationLevel: "Serializable", timeout: 10_000 });
      expect(output.mode).toBe("LICENSE_KEY");
      const outer = JSON.parse(output.envelope);
      const payload = JSON.parse(outer.payload);
      expect(payload.activation_mode).toBe("LICENSE_KEY");
      expect(payload.image_path).toBe(imagePath);
      expect(verify(null, Buffer.from(
        "BKE-STANDALONE-STARTUP-POLICY-V1\n" + outer.payload),
        ds.publicKey, Buffer.from(outer.signature, "base64"))).toBe(true);
      const receipt = await db.$queryRaw<Array<{ signerKid: string }>>`
        SELECT "signerKid" FROM "AgentStartupAttestationReceipt"
         WHERE "attestationId"=${signed.attestationId}::uuid
      `;
      expect(receipt[0]?.signerKid).toBe(machineKid);
      const audit = await db.auditLog.findFirst({
        where: { action: "AGENT_STANDALONE_STARTUP_POLICY_ISSUED",
          targetId: signed.attestationId },
      });
      expect(audit).not.toBeNull();
      expect(audit?.metadata).toMatchObject({
        attestationAlgorithm: "ES256", hardwareAttested: false,
      });
      await expect(db.$transaction(tx =>
        prepareAndSignStandaloneStartupPolicyInTransaction(tx, {
          signedAgentInstallAttestation: signed.raw,
          keyset: signerKeyset,
        }))).rejects.toThrow("STARTUP_POLICY_ATTESTATION_REPLAY");
    });

    it("terminal ES256 key revocation denies fresh authorization, cannot reactivate", async () => {
      const result = await db.$transaction(tx =>
        revokeStartupEs256MachineKeyInTransaction(
          tx, machineKid, secondAdmin, "Preproduction disposable SQL proof complete"));
      expect(result).toEqual({ kid: machineKid, status: "REVOKED" });
      const next = proof();
      await expect(db.$transaction(tx =>
        prepareAndSignStandaloneStartupPolicyInTransaction(tx, {
          signedAgentInstallAttestation: next.raw, keyset: signerKeyset,
        }))).rejects.toThrow("STARTUP_ES256_UNTRUSTED_AGENT");
      await expect(db.$executeRaw`
        UPDATE "AgentStartupAttestationSigningKey"
           SET "status"='ACTIVE',"revokedAt"=NULL
         WHERE "kid"=${machineKid}
      `).rejects.toThrow();
    });
  },
);
