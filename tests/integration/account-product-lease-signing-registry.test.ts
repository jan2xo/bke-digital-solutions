import "dotenv/config";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/platform/host/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  signAccountProductLeaseInTransaction,
  rotateAccountProductLeaseSigningKeyInTransaction,
} from "@/apps/web/agent-sessions/account-product-lease-signer";
import { verifyAccountProductLeaseJws } from "@bke/licensing/providers/ed25519-account-product-lease";
import type { AccountProductLeaseClaims } from "@bke/licensing/contracts/account-product-lease.contract";

const db = new PrismaClient({ adapter: new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
}) });
const one = generateKeyPairSync("ed25519");
const two = generateKeyPairSync("ed25519");
const pub1 = one.publicKey.export({ format: "pem", type: "spki" }).toString();
const pub2 = two.publicKey.export({ format: "pem", type: "spki" }).toString();
const private1 = one.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const private2 = two.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const kid1 = "ci-" + randomUUID();
const kid2 = "ci-" + randomUUID();
const keyset = JSON.stringify({ [kid1]: private1, [kid2]: private2 });
const t = new Date("2026-11-12T17:00:00Z");
const claims: AccountProductLeaseClaims = {
  schema: "bke.product-lease.v1", issuer: "BKE Digital Solutions",
  audience: "bke-product", leaseId: randomUUID(), accountId: "ci-account",
  userId: "ci-user", productId: "bke-render-dock",
  agentSessionId: "ci-agent", agentKeyThumbprint: "a".repeat(43),
  keyProtection: "software", plan: "subscription", allowedActions: ["OPEN"],
  issuedAt: t.toISOString(),
  refreshAfter: new Date(t.getTime() + 90_000).toISOString(),
  expiresAt: new Date(t.getTime() + 180_000).toISOString(),
};
const truth = {
  issuer: claims.issuer, audience: claims.audience,
  accountId: claims.accountId, userId: claims.userId,
  productId: claims.productId, agentSessionId: claims.agentSessionId,
  agentKeyThumbprint: claims.agentKeyThumbprint, action: "OPEN" as const, now: t,
};

describe.runIf(process.env.BKE_ACCOUNT_PRODUCT_LEASE_DB_PROOF === "1")(
  "separate JWS signer key custody + rotation in disposable PostgreSQL",
  { concurrent: false }, () => {
    let adminUser = "";
    afterAll(async () => {
      await db.$executeRaw`DELETE FROM "AccountProductLeaseSigningKey"
        WHERE "kid" IN (${kid1}, ${kid2})`.catch(() => undefined);
      if (adminUser) await db.user.delete({ where: { id: adminUser } }).catch(() => undefined);
      await db.$disconnect();
    });

    it("stages public-only metadata then atomically creates sole ACTIVE signing key", async () => {
      const u = await db.user.create({
        data: { email: `issuer-admin-${randomUUID()}@bke.test` },
      });
      adminUser = u.id;
      await db.$executeRaw`
        INSERT INTO "AccountProductLeaseSigningKey"
          ("kid","publicKeyPem","privateKeyReference","status","activatedAt")
        VALUES (${kid1}, ${pub1},
          ${"keyset:" + kid1}, 'ACTIVE', now())
      `;
      await db.$executeRaw`
        INSERT INTO "AccountProductLeaseSigningKey"
          ("kid","publicKeyPem","privateKeyReference","status")
        VALUES (${kid2}, ${pub2},
          ${"keyset:" + kid2}, 'STAGED')
      `;
      const rows = await db.$queryRaw<Array<{
        kid: string; publicKeyPem: string; privateKeyReference: string;
      }>>`
        SELECT "kid","publicKeyPem","privateKeyReference"
          FROM "AccountProductLeaseSigningKey" WHERE "kid" IN (${kid1},${kid2})
      `;
      expect(rows).toHaveLength(2);
      expect(JSON.stringify(rows)).not.toContain("BEGIN PRIVATE KEY");
      await expect(db.$executeRaw`
        INSERT INTO "AccountProductLeaseSigningKey"
          ("kid","publicKeyPem","privateKeyReference","status","activatedAt")
        VALUES (${"another-" + kid1}, ${pub1},
          ${"keyset:another-" + kid1}, 'ACTIVE', now())
      `).rejects.toThrow();
    });

    it("signs actual immutable v1 JWS with verified registered key", async () => {
      const signed = await db.$transaction(tx =>
        signAccountProductLeaseInTransaction(tx, claims, keyset),
        { isolationLevel: "Serializable" });
      expect(signed.kid).toBe(kid1);
      expect(verifyAccountProductLeaseJws(signed.jws,
        new Map([[kid1, { publicKeyPem: pub1, state: "ACTIVE" }]]), truth))
        .toMatchObject({ ok: true, kid: kid1 });
    });

    it("staged rotation retains old VERIFY_ONLY and switches new ACTIVE atomically", async () => {
      await db.$transaction(tx =>
        rotateAccountProductLeaseSigningKeyInTransaction(tx, {
          newKid: kid2, adminUserId: adminUser, keyset,
        }), { isolationLevel: "Serializable" });
      const rows = await db.$queryRaw<Array<{ kid: string; status: string }>>`
        SELECT "kid", "status" FROM "AccountProductLeaseSigningKey"
         WHERE "kid" IN (${kid1},${kid2})
         ORDER BY "kid"
      `;
      expect(rows).toEqual([
        { kid: kid1, status: "VERIFY_ONLY" },
        { kid: kid2, status: "ACTIVE" },
      ].sort((a,b)=>a.kid.localeCompare(b.kid)));
      const jws = await db.$transaction(tx =>
        signAccountProductLeaseInTransaction(tx, claims, keyset),
        { isolationLevel: "Serializable" });
      expect(jws.kid).toBe(kid2);
      expect(verifyAccountProductLeaseJws(jws.jws,
        new Map([
          [kid1, { publicKeyPem: pub1, state: "VERIFY_ONLY" }],
          [kid2, { publicKeyPem: pub2, state: "ACTIVE" }],
        ]), truth)).toMatchObject({ ok: true, kid: kid2 });
      const audit = await db.auditLog.findFirst({
        where: { action: "ACCOUNT_PRODUCT_SIGNER_ROTATED", targetId: kid2 },
      });
      expect(audit?.metadata).toMatchObject({ previousKid: kid1, newKid: kid2 });
      expect(JSON.stringify(audit?.metadata)).not.toContain("BEGIN PRIVATE KEY");
    });

    it("DB irrevocable revocation and missing ACTIVE signer both fail closed", async () => {
      await db.$executeRaw`
        UPDATE "AccountProductLeaseSigningKey"
           SET "status"='REVOKED', "revokedAt" = now()
         WHERE "kid" = ${kid2}
      `;
      await expect(db.$executeRaw`
        UPDATE "AccountProductLeaseSigningKey"
           SET "status"='ACTIVE', "revokedAt"=NULL
         WHERE "kid" = ${kid2}
      `).rejects.toThrow();
      await expect(db.$transaction(tx =>
        signAccountProductLeaseInTransaction(tx, claims, keyset),
        { isolationLevel: "Serializable" }))
        .rejects.toThrow("ACCOUNT_PRODUCT_SIGNER_NOT_UNIQUE");
    });
  },
);
