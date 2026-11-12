import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/platform/persistence/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  verify: vi.fn(),
  prepare: vi.fn(),
  denialAudit: vi.fn(),
}));

vi.mock("@/platform/host/db", () => ({
  db: { $transaction: mocks.transaction },
}));
vi.mock("@/apps/web/agent-sessions/agent-key-proof-authority", () => ({
  verifyAgentKeyChallenge: mocks.verify,
}));
vi.mock("@/apps/web/agent-sessions/product-lease-preparation-audit", () => ({
  prepareAndAuditProductLeaseInTransaction: mocks.prepare,
  auditDeniedProductLeasePreparationInTransaction: mocks.denialAudit,
}));

import {
  verifyAndAuditAgentProductLeasePreparation,
} from "@/apps/web/agent-sessions/product-lease-atomic-preparation";

const now = new Date("2026-11-12T15:00:00.000Z");
const input = {
  accessToken: "secret-agent-token-never-audited",
  pepper: "secret-hmac-pepper-never-audited",
  challengeId: "one-use-lease-challenge-id",
  messageBase64url: "server-challenge",
  signatureBase64url: "machine-signed-response",
  productId: "render-dock",
  platform: "windows" as const,
  architecture: "x64" as const,
  action: "OPEN" as const,
};
const proof = { trustedBrandedProof: "mock-boundary-only" };
const claims = { leaseId: "audit-source-only-lease", productId: "render-dock" };
const tx = {} as Prisma.TransactionClient;

async function transactionBody(...args: unknown[]) {
  const callback = args[0] as (value: Prisma.TransactionClient) => Promise<unknown>;
  return callback(tx);
}

describe("single SERIALIZABLE lease proof-to-preparation audit — source only", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.transaction.mockImplementation(transactionBody);
    mocks.verify.mockResolvedValue({ status: "verified", proof });
    mocks.prepare.mockResolvedValue({ status: "ready_to_sign", claims });
    mocks.denialAudit.mockResolvedValue(undefined);
  });

  it("runs verified key proof, live eligibility and PREPARED audit in exactly the same transaction", async () => {
    const result = await verifyAndAuditAgentProductLeasePreparation(input, now);
    expect(result).toEqual({ status: "ready_to_sign", claims });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.transaction.mock.calls[0]![1]).toEqual({
      isolationLevel: "Serializable", timeout: 10_000,
    });
    expect(mocks.verify).toHaveBeenCalledTimes(1);
    expect(mocks.verify).toHaveBeenCalledWith(tx, {
      accessToken: input.accessToken,
      pepper: input.pepper,
      challengeId: input.challengeId,
      messageBase64url: input.messageBase64url,
      signatureBase64url: input.signatureBase64url,
      expectedPurpose: "LEASE",
    }, now);
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.prepare).toHaveBeenCalledWith(tx, {
      accessToken: input.accessToken, pepper: input.pepper,
      productId: input.productId, platform: input.platform,
      architecture: input.architecture, action: input.action, proof,
    }, now);
    expect(mocks.denialAudit).not.toHaveBeenCalled();
    expect(mocks.verify.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.prepare.mock.invocationCallOrder[0]!);
  });

  for (const reason of [
    "INVALID_TOKEN", "BAD_SIGNATURE", "INVALID_CHALLENGE", "KEY_REVOKED",
    "INVALID_SCOPE",
  ] as const) {
    it("audits only the typed proof denial " + reason + " and never prepares claims", async () => {
      mocks.verify.mockResolvedValue({ status: "denied", reason });
      const result = await verifyAndAuditAgentProductLeasePreparation(input, now);
      expect(result).toEqual({ status: "denied", reason });
      expect(mocks.denialAudit).toHaveBeenCalledTimes(1);
      expect(mocks.denialAudit).toHaveBeenCalledWith(tx, reason);
      expect(mocks.prepare).not.toHaveBeenCalled();
      const denialArguments = JSON.stringify(mocks.denialAudit.mock.calls);
      expect(denialArguments).not.toContain(input.accessToken);
      expect(denialArguments).not.toContain(input.pepper);
      expect(denialArguments).not.toContain(input.signatureBase64url);
    });
  }

  it("does not treat an ENROLL response as LEASE authority", async () => {
    mocks.verify.mockResolvedValue({ status: "enrolled", registrationId: "not-a-lease" });
    expect(await verifyAndAuditAgentProductLeasePreparation(input, now))
      .toEqual({ status: "denied", reason: "INVALID_CHALLENGE" });
    expect(mocks.denialAudit).toHaveBeenCalledWith(tx, "INVALID_CHALLENGE");
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("does not double-audit when the entitlement or key gate denies", async () => {
    mocks.prepare.mockResolvedValue({
      status: "denied", reason: "NOT_ELIGIBLE",
    });
    expect(await verifyAndAuditAgentProductLeasePreparation(input, now))
      .toEqual({ status: "denied", reason: "NOT_ELIGIBLE" });
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.denialAudit).not.toHaveBeenCalled();
  });

  it("fails closed on proof-denial audit failure, requiring transaction rollback", async () => {
    mocks.verify.mockResolvedValue({ status: "denied", reason: "BAD_SIGNATURE" });
    mocks.denialAudit.mockRejectedValue(new Error("AUDIT_WRITE_FAILED"));
    await expect(verifyAndAuditAgentProductLeasePreparation(input, now))
      .rejects.toThrow("AUDIT_WRITE_FAILED");
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("fails closed on prepared audit failure within transaction", async () => {
    mocks.prepare.mockRejectedValue(new Error("PREPARED_AUDIT_FAILED"));
    await expect(verifyAndAuditAgentProductLeasePreparation(input, now))
      .rejects.toThrow("PREPARED_AUDIT_FAILED");
  });

  it("never returns prepared claims if the DB transaction commit rejects", async () => {
    mocks.transaction.mockImplementationOnce(async (...args: unknown[]) => {
      await transactionBody(...args);
      throw new Error("SERIALIZABLE_COMMIT_ABORTED");
    });
    await expect(verifyAndAuditAgentProductLeasePreparation(input, now))
      .rejects.toThrow("SERIALIZABLE_COMMIT_ABORTED");
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
  });

  it("does not start a transaction with an invalid server clock", async () => {
    await expect(verifyAndAuditAgentProductLeasePreparation(input, new Date(NaN)))
      .rejects.toThrow("PRODUCT_LEASE_PREPARATION_CLOCK_INVALID");
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it("propagates SQL verification failure without logging credentials or preparing rights", async () => {
    mocks.verify.mockRejectedValue(new Error("DISPOSABLE_PG_UNAVAILABLE"));
    await expect(verifyAndAuditAgentProductLeasePreparation(input, now))
      .rejects.toThrow("DISPOSABLE_PG_UNAVAILABLE");
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.denialAudit).not.toHaveBeenCalled();
  });
});
