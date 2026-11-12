import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/platform/persistence/generated/prisma/client";
import type { PreparedProductLeaseClaims } from "@/apps/web/agent-sessions/product-lease-issuance-plan";
import { prepareAndAuditProductLeaseInTransaction } from "@/apps/web/agent-sessions/product-lease-preparation-audit";
import { prepareVerifiedProductLeaseInTransaction } from "@/apps/web/agent-sessions/product-lease-transaction-gate";

vi.mock("@/apps/web/agent-sessions/product-lease-transaction-gate", () => ({
  prepareVerifiedProductLeaseInTransaction: vi.fn(),
}));

const gate = vi.mocked(prepareVerifiedProductLeaseInTransaction);
const now = new Date("2026-11-12T10:00:00.000Z");
const input = {
  accessToken: "do-not-log-authenticated-agent-bearer",
  pepper: "do-not-log-hmac-pepper",
  productId: "render-dock",
  platform: "windows" as const,
  architecture: "x64" as const,
  action: "OPEN" as const,
  proof: null,
};
const claims: PreparedProductLeaseClaims = {
  schema: "bke.product-lease.v1",
  issuer: "BKE Digital Solutions",
  audience: "bke-product",
  leaseId: "lease-id-1",
  accountId: "authenticated-account",
  userId: "authenticated-user",
  productId: "render-dock",
  agentSessionId: "authenticated-agent-session",
  agentKeyThumbprint: "a".repeat(43),
  keyProtection: "software",
  plan: "subscription",
  allowedActions: ["OPEN"],
  issuedAt: now.toISOString(),
  refreshAfter: new Date(now.getTime() + 150_000).toISOString(),
  expiresAt: new Date(now.getTime() + 300_000).toISOString(),
};
function transaction() {
  const create = vi.fn().mockResolvedValue({ id: "durable-audit-record" });
  const tx = { auditLog: { create } } as unknown as Prisma.TransactionClient;
  return { tx, create };
}

describe("transaction-bound product lease preparation audit — source only, no JWS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gate.mockResolvedValue({ status: "ready_to_sign", claims });
  });

  it("writes exactly one PREPARED audit after trusted gate using same transaction", async () => {
    const { tx, create } = transaction();
    const result = await prepareAndAuditProductLeaseInTransaction(tx, input, now);
    expect(result).toEqual({ status: "ready_to_sign", claims });
    expect(gate).toHaveBeenCalledTimes(1);
    expect(gate).toHaveBeenCalledWith(tx, input, now);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      data: {
        actorId: "authenticated-user",
        accountId: "authenticated-account",
        action: "AGENT_PRODUCT_LEASE_PREPARED",
        targetType: "AgentProductLease",
        targetId: "lease-id-1",
        metadata: {
          schema: "bke.product-lease.preparation-audit.v1",
          productId: "render-dock",
          action: "OPEN",
          agentSessionId: "authenticated-agent-session",
          agentKeyThumbprint: "a".repeat(43),
          expiresAt: claims.expiresAt,
        },
      },
    });
    expect(gate.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0]!);
    const serializedAudit = JSON.stringify(create.mock.calls);
    for (const secret of [
      input.accessToken, input.pepper, "privateKey", "signatureBase64url",
      "messageBase64url", "device_code", "publicKeyPem",
    ]) expect(serializedAudit).not.toContain(secret);
    expect(serializedAudit).not.toContain("AGENT_PRODUCT_LEASE_ISSUED");
  });

  for (const reason of [
    "INVALID_TOKEN", "NOT_ELIGIBLE", "UNTRUSTED_MACHINE_KEY",
    "STALE_KEY_PROOF", "INVALID_CONTEXT", "RIGHTS_EXPIRE_TOO_SOON",
  ] as const) {
    it("records denied " + reason + " without forged identity attribution", async () => {
      gate.mockResolvedValue({ status: "denied", reason });
      const { tx, create } = transaction();
      const result = await prepareAndAuditProductLeaseInTransaction(tx, input, now);
      expect(result).toEqual({ status: "denied", reason });
      expect(create).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledWith({
        data: {
          actorId: null,
          accountId: null,
          action: "AGENT_PRODUCT_LEASE_PREPARATION_DENIED",
          targetType: "AgentProductLease",
          targetId: null,
          metadata: { schema: "bke.product-lease.preparation-audit.v1", reason },
        },
      });
      const stored = JSON.stringify(create.mock.calls);
      expect(stored).not.toContain(input.accessToken);
      expect(stored).not.toContain(input.pepper);
      expect(stored).not.toContain(input.productId);
      expect(stored).not.toContain("authenticated-account");
    });
  }

  it("fails closed rather than returning prepared rights when audit persistence fails", async () => {
    const { tx, create } = transaction();
    create.mockRejectedValueOnce(new Error("AUDIT_PERSISTENCE_FAILED"));
    await expect(prepareAndAuditProductLeaseInTransaction(tx, input, now))
      .rejects.toThrow("AUDIT_PERSISTENCE_FAILED");
    expect(gate).toHaveBeenCalledOnce();
  });

  it("fails closed on denial-audit persistence failure", async () => {
    gate.mockResolvedValue({ status: "denied", reason: "INVALID_TOKEN" });
    const { tx, create } = transaction();
    create.mockRejectedValueOnce(new Error("AUDIT_PERSISTENCE_FAILED"));
    await expect(prepareAndAuditProductLeaseInTransaction(tx, input, now))
      .rejects.toThrow("AUDIT_PERSISTENCE_FAILED");
  });

  it("does not fabricate an audit when verification itself throws", async () => {
    gate.mockRejectedValueOnce(new Error("LEASE_PROOF_VERIFICATION_FAILED"));
    const { tx, create } = transaction();
    await expect(prepareAndAuditProductLeaseInTransaction(tx, input, now))
      .rejects.toThrow("LEASE_PROOF_VERIFICATION_FAILED");
    expect(create).not.toHaveBeenCalled();
  });
});
