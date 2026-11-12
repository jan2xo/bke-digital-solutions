import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/platform/persistence/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  verify: vi.fn(),
  prepare: vi.fn(),
  denial: vi.fn(),
  sign: vi.fn(),
}));
vi.mock("@/platform/host/db", () => ({
  db: { $transaction: mocks.transaction },
}));
vi.mock("@/apps/web/agent-sessions/agent-key-proof-authority", () => ({
  verifyAgentKeyChallenge: mocks.verify,
}));
vi.mock("@/apps/web/agent-sessions/product-lease-preparation-audit", () => ({
  prepareAndAuditProductLeaseInTransaction: mocks.prepare,
  auditDeniedProductLeasePreparationInTransaction: mocks.denial,
}));
vi.mock("@/apps/web/agent-sessions/account-product-lease-signer", () => ({
  signAccountProductLeaseInTransaction: mocks.sign,
}));

import {
  issueAgentAccountProductLease,
} from "@/apps/web/agent-sessions/account-product-lease-issuance";

const now = new Date("2026-11-12T17:00:00.000Z");
const claims = {
  schema: "bke.product-lease.v1",
  issuer: "BKE Digital Solutions", audience: "bke-product",
  leaseId: "test-uuid-lease-id", accountId: "authenticated-account",
  userId: "authenticated-user", productId: "render-dock",
  agentSessionId: "authenticated-session",
  agentKeyThumbprint: "a".repeat(43), keyProtection: "software",
  plan: "subscription", allowedActions: ["OPEN"],
  issuedAt: now.toISOString(),
  refreshAfter: new Date(now.getTime() + 120_000).toISOString(),
  expiresAt: new Date(now.getTime() + 240_000).toISOString(),
};
const input = {
  accessToken: "secret-access-token-shall-not-be-audited",
  pepper: "strong-secret-server-side-HMAC-pepper",
  challengeId: "one-use-lease-challenge",
  messageBase64url: "one-use-lease-message",
  signatureBase64url: "signed-possession-response",
  productId: "render-dock",
  platform: "windows" as const,
  architecture: "x64" as const,
  action: "OPEN" as const,
};
const keyset = "SECRET_PRIVATE_KEY_MAP_NEVER_AUDITED";
const jws = "signed.original.immutable";
const fakeTx = { auditLog: { create: vi.fn() } } as unknown as Prisma.TransactionClient;

describe("account JWS issuance: one atomic proof/rights/sign/audit/commit", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.transaction.mockImplementation(async (
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
    ) => callback(fakeTx));
    mocks.verify.mockResolvedValue({ status: "verified", proof: { brand: true } });
    mocks.prepare.mockResolvedValue({ status: "ready_to_sign", claims });
    mocks.sign.mockResolvedValue({ kid: "disposable-ed25519-key", jws });
    vi.mocked(fakeTx.auditLog.create).mockResolvedValue({ id: "audit" } as never);
  });

  it("consumes a LEASE, prepares rights, signs and audits ISSUED BEFORE commit", async () => {
    const result = await issueAgentAccountProductLease(input, keyset, now);
    expect(result).toEqual({
      status: "issued", jws, kid: "disposable-ed25519-key",
      expiresAt: claims.expiresAt, refreshAfter: claims.refreshAfter,
    });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.transaction.mock.calls[0]![1]).toEqual({
      isolationLevel: "Serializable", timeout: 10_000,
    });
    expect(mocks.verify).toHaveBeenCalledWith(fakeTx, {
      accessToken: input.accessToken, pepper: input.pepper,
      challengeId: input.challengeId,
      messageBase64url: input.messageBase64url,
      signatureBase64url: input.signatureBase64url,
      expectedPurpose: "LEASE",
    }, now);
    expect(mocks.prepare).toHaveBeenCalledWith(fakeTx, {
      accessToken: input.accessToken, pepper: input.pepper,
      productId: input.productId, platform: "windows", architecture: "x64",
      action: "OPEN", proof: { brand: true },
    }, now);
    expect(mocks.sign).toHaveBeenCalledWith(fakeTx, claims, keyset);
    expect(fakeTx.auditLog.create).toHaveBeenCalledOnce();
    expect(fakeTx.auditLog.create).toHaveBeenCalledWith({ data: {
      actorId: claims.userId, accountId: claims.accountId,
      action: "AGENT_PRODUCT_LEASE_ISSUED",
      targetType: "AgentProductLease", targetId: claims.leaseId,
      metadata: {
        schema: "bke.product-lease.issuance-audit.v1",
        kid: "disposable-ed25519-key", productId: claims.productId,
        action: "OPEN", agentSessionId: claims.agentSessionId,
        agentKeyThumbprint: claims.agentKeyThumbprint,
        expiresAt: claims.expiresAt,
        jwsSha256: createHash("sha256").update(jws).digest("hex"),
      },
    } });
    const steps = [
      mocks.verify.mock.invocationCallOrder[0]!,
      mocks.prepare.mock.invocationCallOrder[0]!,
      mocks.sign.mock.invocationCallOrder[0]!,
      vi.mocked(fakeTx.auditLog.create).mock.invocationCallOrder[0]!,
    ];
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
    const audit = JSON.stringify(vi.mocked(fakeTx.auditLog.create).mock.calls);
    for (const secret of [
      input.accessToken, input.pepper, keyset,
      input.signatureBase64url, input.messageBase64url, jws,
    ]) expect(audit).not.toContain(secret);
  });

  it("never signs or issues for invalid proof and audited denial", async () => {
    mocks.verify.mockResolvedValue({ status: "denied", reason: "BAD_SIGNATURE" });
    expect(await issueAgentAccountProductLease(input, keyset, now)).toEqual({
      status: "denied", reason: "BAD_SIGNATURE",
    });
    expect(mocks.denial).toHaveBeenCalledWith(fakeTx, "BAD_SIGNATURE");
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it("refuses ENROLL as LEASE without signing", async () => {
    mocks.verify.mockResolvedValue({ status: "enrolled", registrationId: "x" });
    expect(await issueAgentAccountProductLease(input, keyset, now)).toEqual({
      status: "denied", reason: "INVALID_CHALLENGE",
    });
    expect(mocks.denial).toHaveBeenCalledWith(fakeTx, "INVALID_CHALLENGE");
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it("does not sign if entitlement, key or product mode gate denies", async () => {
    mocks.prepare.mockResolvedValue({ status: "denied", reason: "NOT_ELIGIBLE" });
    expect(await issueAgentAccountProductLease(input, keyset, now)).toEqual({
      status: "denied", reason: "NOT_ELIGIBLE",
    });
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(fakeTx.auditLog.create).not.toHaveBeenCalled();
  });

  it("rolls back on missing active signing key or key mismatch", async () => {
    mocks.sign.mockRejectedValue(new Error("ACCOUNT_PRODUCT_SIGNER_KEY_MISMATCH"));
    await expect(issueAgentAccountProductLease(input, keyset, now))
      .rejects.toThrow("ACCOUNT_PRODUCT_SIGNER_KEY_MISMATCH");
    expect(fakeTx.auditLog.create).not.toHaveBeenCalled();
  });

  it("does not return signed JWS on ISSUED audit failure", async () => {
    vi.mocked(fakeTx.auditLog.create)
      .mockRejectedValueOnce(new Error("AUDIT_WRITE_FAILED"));
    await expect(issueAgentAccountProductLease(input, keyset, now))
      .rejects.toThrow("AUDIT_WRITE_FAILED");
  });

  it("does not return signed JWS on transaction commit failure", async () => {
    mocks.transaction.mockImplementationOnce(async (
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
    ) => {
      await callback(fakeTx);
      throw new Error("SERIALIZABLE_COMMIT_ABORTED");
    });
    await expect(issueAgentAccountProductLease(input, keyset, now))
      .rejects.toThrow("SERIALIZABLE_COMMIT_ABORTED");
    expect(mocks.sign).toHaveBeenCalledOnce();
  });

  it("invalid server clock cannot consume nonce or sign", async () => {
    await expect(issueAgentAccountProductLease(input, keyset, new Date(NaN)))
      .rejects.toThrow("ACCOUNT_PRODUCT_LEASE_CLOCK_INVALID");
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it("denial audit failure aborts before any signed issuance", async () => {
    mocks.verify.mockResolvedValue({ status: "denied", reason: "INVALID_TOKEN" });
    mocks.denial.mockRejectedValueOnce(new Error("AUDIT_FAILURE"));
    await expect(issueAgentAccountProductLease(input, keyset, now))
      .rejects.toThrow("AUDIT_FAILURE");
    expect(mocks.sign).not.toHaveBeenCalled();
  });
});
