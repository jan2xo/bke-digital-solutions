import "dotenv/config";

import { createHash, generateKeyPairSync, randomUUID, sign, verify } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/platform/persistence/generated/prisma/client";
import {
  standaloneStartupAttestationContract,
} from "@/apps/web/agent-sessions/standalone-startup-install-attestation";
import {
  prepareAndSignStandaloneStartupPolicyInTransaction,
} from "@/apps/web/agent-sessions/standalone-startup-policy-issuance";

// Only the disposable CORE PostgreSQL test container is eligible. No local,
// staging or production DB shall ever receive the test keys/mutations.
const eligible = (() => {
  if (process.env.GITHUB_ACTIONS !== "true" ||
      process.env.NODE_ENV !== "test" ||
      process.env.BKE_PRODUCT_ACTIVATION_DB_PROOF !== "1") return false;
  try {
    const dbUrl = new URL(process.env.DATABASE_URL ?? "");
    return ["localhost", "127.0.0.1"].includes(dbUrl.hostname) &&
      dbUrl.port === "5432" && dbUrl.pathname === "/bke_test";
  } catch { return false; }
})();
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});
const installer = generateKeyPairSync("ed25519");
const issuer = generateKeyPairSync("ed25519");
const machineKid = "ci-startup-" + randomUUID();
const stagingAdminId = "ci-stager-" + randomUUID();
const reviewingAdminId = "ci-reviewer-" + randomUUID();
const signerKid = "ci-policy-" + randomUUID();
const productId = "ci-startup-" + randomUUID().slice(0, 8);
const deviceId = "ci-startup-device-" + randomUUID();
const version = "1.0.3";
const image = "C:\\Program Files\\BKE Digital Solutions\\Render Dock\\RENDER DOCK.exe";
const installationId = randomUUID();
const signerKeyset = JSON.stringify({
  [signerKid]: issuer.privateKey.export({
    type: "pkcs8", format: "pem",
  }).toString(),
});
let productDatabaseId = "";
const issuedAttestations: string[] = [];

function makeAttestation() {
  const now = new Date();
  const attestationId = randomUUID();
  issuedAttestations.push(attestationId);
  const payload = JSON.stringify({
    schema: standaloneStartupAttestationContract.payloadSchema,
    product_id: productId, version,
    installation_id: installationId,
    image_path: image, image_sha256: "b".repeat(64),
    allowed_user_sid: "S-1-5-21-111-222-333-1001",
    device_id: deviceId,
    attestation_id: attestationId,
    issued_at: new Date(now.getTime() - 2000).toISOString(),
    expires_at: new Date(now.getTime() + 90000).toISOString(),
  });
  return {
    attestationId,
    raw: JSON.stringify({
      schema: standaloneStartupAttestationContract.envelopeSchema,
      kid: machineKid, payload,
      signature: sign(null, Buffer.from(
        standaloneStartupAttestationContract.signedDomain + payload),
        installer.privateKey).toString("base64"),
    }),
  };
}

describe.runIf(eligible)(
  "signed machine/install + SQL mode issuer — disposable PostgreSQL",
  { concurrent: false }, () => {
    afterAll(async () => {
      if (issuedAttestations.length) {
        await db.$executeRaw`
          DELETE FROM "AgentStartupAttestationReceipt"
           WHERE "signerKid" = ${machineKid}
        `.catch(() => undefined);
      }
      await db.$executeRaw`
        DELETE FROM "AgentStartupAttestationSigningKey"
         WHERE "kid" = ${machineKid}
      `.catch(() => undefined);
      await db.$executeRaw`
        DELETE FROM "AccountProductLeaseSigningKey"
         WHERE "kid" = ${signerKid}
      `.catch(() => undefined);
      if (productDatabaseId) {
        await db.auditLog.deleteMany({
          where: { action: "AGENT_STANDALONE_STARTUP_POLICY_ISSUED",
            targetType: "AgentStandaloneStartupPolicy",
            targetId: { in: issuedAttestations } },
        }).catch(() => undefined);
        await db.product.delete({
          where: { id: productDatabaseId },
        }).catch(() => undefined);
      }
      await db.user.deleteMany({ where: { id: { in: [stagingAdminId, reviewingAdminId] } } });
      await db.$disconnect();
    });

    it("enrolls disposable PUBLIC key only and publishes LICENSE_KEY SQL-owned product", async () => {
      const signerRows = await db.$queryRaw<Array<{ kid: string }>>`
        SELECT "kid" FROM "AccountProductLeaseSigningKey"
         WHERE "status" = 'ACTIVE'
      `;
      expect(signerRows).toHaveLength(0);
      await db.user.createMany({ data: [
        { id: stagingAdminId, email: "stager-" + randomUUID() + "@example.test",
          role: "ADMIN", lifecycleState: "ACTIVE" },
        { id: reviewingAdminId, email: "reviewer-" + randomUUID() + "@example.test",
          role: "ADMIN", lifecycleState: "ACTIVE" },
      ] });
      const publicPem = installer.publicKey.export({ type: "spki", format: "pem" }).toString();
      const publicSha = createHash("sha256").update(
        installer.publicKey.export({ type: "spki", format: "der" })).digest("hex");
      await expect(db.$executeRaw`
        INSERT INTO "AgentStartupAttestationSigningKey"
          ("kid","deviceId","publicKeyPem","status")
        VALUES (${machineKid}, ${deviceId}, ${publicPem}, 'ACTIVE')
      `).rejects.toThrow();
      await db.$executeRaw`
        INSERT INTO "AgentStartupAttestationSigningKey"
          ("kid","deviceId","publicKeyPem","publicKeySha256","stagedBy","status")
        VALUES (${machineKid}, ${deviceId}, ${publicPem},
                ${publicSha}, ${stagingAdminId}, 'STAGED')
      `;
      await expect(db.$executeRaw`
        UPDATE "AgentStartupAttestationSigningKey"
           SET "status"='ACTIVE', "activatedAt"=now(),
               "activatedBy"=${stagingAdminId}, "reviewedAt"=now(),
               "activationProofSha256"=${"a".repeat(64)}
         WHERE "kid"=${machineKid}
      `).rejects.toThrow();
      await db.$executeRaw`
        UPDATE "AgentStartupAttestationSigningKey"
           SET "status"='ACTIVE', "activatedAt"=now(),
               "activatedBy"=${reviewingAdminId}, "reviewedAt"=now(),
               "activationProofSha256"=${"a".repeat(64)}
         WHERE "kid"=${machineKid}
      `;
      await db.$executeRaw`
        INSERT INTO "AccountProductLeaseSigningKey"
          ("kid","publicKeyPem","privateKeyReference","status","activatedAt")
        VALUES (
          ${signerKid},
          ${issuer.publicKey.export({ type: "spki", format: "pem" }).toString()},
          ${"keyset:" + signerKid}, 'ACTIVE', now()
        )
      `;
      const product = await db.product.create({
        data: {
          slug: productId, productId,
          name: "Disposable Startup Installer Fixture",
          summary: "Certifies signed policy without a Google account.",
          description: "Preproduction only; never publish or activate a customer.",
          type: "SOFTWARE", active: false,
          launcherExecutionType: "STANDALONE",
          licenseType: "Commercial",
        },
      });
      productDatabaseId = product.id;
      await db.$executeRaw`
        UPDATE "ProductActivationPolicy"
           SET "activationMode" = 'LICENSE_KEY'
         WHERE "productId" = ${product.id}
      `;
      await db.product.update({
        where: { id: product.id },
        data: { active: true, publishedAt: new Date() },
      });
      await db.productVersion.create({
        data: {
          productId: product.id, version,
          operatingSystem: "windows", architecture: "x64",
          lifecycle: "STABLE", active: true,
          publishedAt: new Date(),
        },
      });
      const modeRows = await db.$queryRaw<Array<{ mode: string }>>`
        SELECT "activationMode" AS "mode"
          FROM "ProductActivationPolicy"
         WHERE "productId" = ${product.id}
      `;
      expect(modeRows[0]?.mode).toBe("LICENSE_KEY");
      const machineRows = await db.$queryRaw<Array<{ publicKeyPem: string }>>`
        SELECT "publicKeyPem" FROM "AgentStartupAttestationSigningKey"
         WHERE "kid" = ${machineKid}
      `;
      expect(machineRows).toHaveLength(1);
      expect(machineRows[0]?.publicKeyPem).not.toContain("PRIVATE KEY");
    });

    it("atomically signs from SQL and burns one attestation; no account required", async () => {
      const proof = makeAttestation();
      const result = await db.$transaction(
        tx => prepareAndSignStandaloneStartupPolicyInTransaction(tx, {
          signedAgentInstallAttestation: proof.raw,
          keyset: signerKeyset,
        }), { isolationLevel: "Serializable", timeout: 10_000 },
      );
      expect(result.mode).toBe("LICENSE_KEY");
      expect(result.status).toBe("issued");
      const parsed = JSON.parse(result.envelope);
      const policy = JSON.parse(parsed.payload);
      expect(policy.activation_mode).toBe("LICENSE_KEY");
      expect(policy.image_path).toBe(image);
      expect(verify(null, Buffer.from(
        "BKE-STANDALONE-STARTUP-POLICY-V1\n" + parsed.payload),
        issuer.publicKey,
        Buffer.from(parsed.signature, "base64"))).toBe(true);
      const receiptRows = await db.$queryRaw<Array<{ attestationId: string }>>`
        SELECT "attestationId"::text AS "attestationId"
          FROM "AgentStartupAttestationReceipt"
         WHERE "attestationId" = ${proof.attestationId}::uuid
      `;
      expect(receiptRows).toEqual([{ attestationId: proof.attestationId }]);
      const audit = await db.auditLog.findFirst({
        where: {
          action: "AGENT_STANDALONE_STARTUP_POLICY_ISSUED",
          targetId: proof.attestationId,
        },
      });
      expect(audit).not.toBeNull();
      expect(JSON.stringify(audit)).not.toContain("PRIVATE KEY");
      await expect(db.$transaction(
        tx => prepareAndSignStandaloneStartupPolicyInTransaction(tx, {
          signedAgentInstallAttestation: proof.raw,
          keyset: signerKeyset,
        }), { isolationLevel: "Serializable" },
      )).rejects.toThrow("STARTUP_POLICY_ATTESTATION_REPLAY");
    });

    it("rolls back nonce on signer failure; corrected signing may consume exactly once", async () => {
      const proof = makeAttestation();
      await expect(db.$transaction(
        tx => prepareAndSignStandaloneStartupPolicyInTransaction(tx, {
          signedAgentInstallAttestation: proof.raw,
          keyset: JSON.stringify({ [signerKid]: "INVALID_PRIVATE_KEY" }),
        }), { isolationLevel: "Serializable" },
      )).rejects.toThrow();
      const absent = await db.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM "AgentStartupAttestationReceipt"
         WHERE "attestationId" = ${proof.attestationId}::uuid
      `;
      expect(absent[0]?.count).toBe(0n);
      const good = await db.$transaction(
        tx => prepareAndSignStandaloneStartupPolicyInTransaction(tx, {
          signedAgentInstallAttestation: proof.raw,
          keyset: signerKeyset,
        }), { isolationLevel: "Serializable" },
      );
      expect(good.status).toBe("issued");
    });

    it("SQL enforces immutable machine public key and terminal revocation", async () => {
      await expect(db.$executeRaw`
        UPDATE "AgentStartupAttestationSigningKey"
           SET "publicKeyPem" = 'TAMPERED'
         WHERE "kid" = ${machineKid}
      `).rejects.toThrow();
      await db.$executeRaw`
        UPDATE "AgentStartupAttestationSigningKey"
           SET "status" = 'REVOKED', "revokedAt" = now(),
               "revokedBy" = ${reviewingAdminId}
         WHERE "kid" = ${machineKid}
      `;
      await expect(db.$executeRaw`
        UPDATE "AgentStartupAttestationSigningKey"
           SET "status" = 'ACTIVE', "revokedAt" = NULL
         WHERE "kid" = ${machineKid}
      `).rejects.toThrow();
      const proof = makeAttestation();
      await expect(db.$transaction(
        tx => prepareAndSignStandaloneStartupPolicyInTransaction(tx, {
          signedAgentInstallAttestation: proof.raw,
          keyset: signerKeyset,
        }), { isolationLevel: "Serializable" },
      )).rejects.toThrow("STARTUP_ATTESTATION_UNTRUSTED_AGENT");
    });
  },
);
