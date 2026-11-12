import { generateKeyPairSync, createPublicKey } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/platform/persistence/generated/prisma/client";
import type { AccountProductLeaseClaims } from "@bke/licensing/contracts/account-product-lease.contract";
import {
  verifyAccountProductLeaseJws,
} from "@bke/licensing/providers/ed25519-account-product-lease";
import {
  signAccountProductLeaseInTransaction,
  rotateAccountProductLeaseSigningKeyInTransaction,
} from "@/apps/web/agent-sessions/account-product-lease-signer";

const kp = generateKeyPairSync("ed25519");
const other = generateKeyPairSync("ed25519");
const pem = kp.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const pub = kp.publicKey.export({ type: "spki", format: "pem" }).toString();
const otherPem = other.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const otherPub = other.publicKey.export({ type: "spki", format: "pem" }).toString();
const keyset = JSON.stringify({ "test-account-key-a": pem, "test-account-key-b": otherPem });
const row = {
  kid: "test-account-key-a", publicKeyPem: pub,
  privateKeyReference: "keyset:test-account-key-a",
  status: "ACTIVE" as const,
};
const now = new Date("2026-11-12T08:00:00.000Z");
const claims: AccountProductLeaseClaims = {
  schema: "bke.product-lease.v1", issuer: "BKE Digital Solutions",
  audience: "bke-product", leaseId: "sample-leased-uuid",
  accountId: "trusted-account", userId: "trusted-user",
  productId: "bke-render-dock", agentSessionId: "trusted-agent-session",
  agentKeyThumbprint: "a".repeat(43),
  keyProtection: "software", plan: "subscription", allowedActions: ["OPEN"],
  issuedAt: now.toISOString(),
  refreshAfter: new Date(now.getTime() + 90_000).toISOString(),
  expiresAt: new Date(now.getTime() + 180_000).toISOString(),
};

function txWith(rows: unknown[]) {
  const query = vi.fn().mockResolvedValue(rows);
  const execute = vi.fn().mockResolvedValue(1);
  const audit = vi.fn().mockResolvedValue({});
  const tx = { $queryRaw: query, $executeRaw: execute,
    auditLog: { create: audit } } as unknown as Prisma.TransactionClient;
  return { tx, query, execute, audit };
}

describe("separate transaction-locked Ed25519 account signing key registry", () => {
  it("signs an actual v1 JWS and independently verifies with public-only key", async () => {
    const { tx, query } = txWith([row]);
    const signed = await signAccountProductLeaseInTransaction(tx, claims, keyset);
    expect(signed.kid).toBe(row.kid);
    expect(signed.jws.split(".")).toHaveLength(3);
    const result = verifyAccountProductLeaseJws(signed.jws,
      new Map([[row.kid, { publicKeyPem: pub, state: "ACTIVE" }]]), {
        issuer: claims.issuer, audience: claims.audience,
        accountId: claims.accountId, userId: claims.userId,
        productId: claims.productId, agentSessionId: claims.agentSessionId,
        agentKeyThumbprint: claims.agentKeyThumbprint, action: "OPEN", now,
      });
    expect(result).toMatchObject({ ok: true, kid: row.kid });
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("AccountProductLeaseSigningKey");
    expect(sql).toContain("FOR SHARE");
    expect(sql).not.toContain("CommercialSigningKey");
  });

  it("rejects absent, multiple, revoked or verify-only active signers", async () => {
    for (const rows of [[], [row, row],
      [{ ...row, status: "REVOKED" }],
      [{ ...row, status: "VERIFY_ONLY" }]]) {
      const { tx } = txWith(rows);
      await expect(signAccountProductLeaseInTransaction(tx, claims, keyset))
        .rejects.toThrow("ACCOUNT_PRODUCT_SIGNER_NOT_UNIQUE");
    }
  });

  it("never signs with unknown key or reused commercial key / wrong public half", async () => {
    for (const [entry, keys] of [
      [{ ...row, kid: "unknown", privateKeyReference: "keyset:unknown" }, keyset],
      [row, JSON.stringify({ "test-account-key-a": otherPem })],
      [{ ...row, publicKeyPem: otherPub }, keyset],
      [{ ...row, privateKeyReference: "env:LICENSE_SIGNING_PRIVATE_KEY" }, keyset],
      [row, "{bad-json"],
    ] as const) {
      const { tx } = txWith([entry]);
      await expect(signAccountProductLeaseInTransaction(tx, claims, keys)).rejects.toThrow();
    }
  });

  it("requires a staged valid key before retiring current ACTIVE to VERIFY_ONLY", async () => {
    const current = row;
    const next = {
      kid: "test-account-key-b", publicKeyPem: otherPub,
      privateKeyReference: "keyset:test-account-key-b",
      status: "STAGED" as const,
    };
    const { tx, query, execute, audit } = txWith([]);
    query.mockResolvedValueOnce([current]).mockResolvedValueOnce([next]);
    await rotateAccountProductLeaseSigningKeyInTransaction(tx, {
      newKid: next.kid, adminUserId: "authenticated-admin", keyset,
    });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(audit).toHaveBeenCalledWith({ data: {
      actorId: "authenticated-admin", action: "ACCOUNT_PRODUCT_SIGNER_ROTATED",
      targetType: "AccountProductLeaseSigningKey",
      targetId: next.kid,
      metadata: { previousKid: current.kid, newKid: next.kid },
    } });
    expect(JSON.stringify(audit.mock.calls)).not.toContain(pem);
  });

  it("denies revoked, non-staged or mismatched rotation before any writes", async () => {
    for (const nextStatus of ["REVOKED", "VERIFY_ONLY", "ACTIVE", "STAGED"]) {
      const { tx, query, execute, audit } = txWith([]);
      query.mockResolvedValueOnce([row]).mockResolvedValueOnce([{
        kid: "test-account-key-b", publicKeyPem: nextStatus === "STAGED" ? pub : otherPub,
        privateKeyReference: "keyset:test-account-key-b", status: nextStatus,
      }]);
      await expect(rotateAccountProductLeaseSigningKeyInTransaction(tx, {
        newKid: "test-account-key-b", adminUserId: "trusted-admin", keyset,
      })).rejects.toThrow();
      expect(execute).not.toHaveBeenCalled();
      expect(audit).not.toHaveBeenCalled();
    }
  });

  it("derives Ed25519 public material from private; malformed keysets never disclose PEM", async () => {
    const { tx } = txWith([row]);
    const e = await signAccountProductLeaseInTransaction(tx, claims,
      JSON.stringify({ "test-account-key-a": "bad-secret" })).catch(v => v as Error);
    expect((e as Error).message).not.toContain("bad-secret");
    expect(createPublicKey(kp.privateKey).export({ type: "spki", format: "pem" }))
      .toEqual(pub);
  });
});
