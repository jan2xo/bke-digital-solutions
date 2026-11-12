import { createHash, generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/platform/persistence/generated/prisma/client";
import {
  prepareVerifiedProductLeaseInTransaction,
} from "@/apps/web/agent-sessions/product-lease-transaction-gate";
import {
  checkAgentProductLeaseEligibilityInTransaction,
} from "@/apps/web/agent-sessions/product-lease-eligibility";
import {
  prepareLeaseClaimsWithVerifiedKey, type VerifiedAgentLeaseProof,
} from "@/apps/web/agent-sessions/agent-key-proof-authority";

vi.mock("@/apps/web/agent-sessions/product-lease-eligibility", () => ({
  checkAgentProductLeaseEligibilityInTransaction: vi.fn(),
}));
vi.mock("@/apps/web/agent-sessions/agent-key-proof-authority", () => ({
  prepareLeaseClaimsWithVerifiedKey: vi.fn(),
}));

const now = new Date("2026-11-12T02:00:00.000Z");
const until = new Date(now.getTime() + 300_000);
const ed = generateKeyPairSync("ed25519");
const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const edPem = ed.publicKey.export({ format: "pem", type: "spki" }).toString();
const ecPem = ec.publicKey.export({ format: "pem", type: "spki" }).toString();
const thumbprint = (pem: string) => createHash("sha256")
  .update((pem === edPem ? ed.publicKey : ec.publicKey).export({ format: "der", type: "spki" }))
  .digest("base64url");
const keyRow = (pem = edPem, changes: Record<string, unknown> = {}) => ({
  id: "registration-01", sessionId: "authenticated-session",
  accountId: "owner-account", userId: "owner-user", publicKeyPem: pem,
  keyThumbprint: thumbprint(pem), keyAlgorithm: pem === edPem ? "EdDSA" : "ES256",
  status: "ACTIVE", validUntil: until, ...changes,
});
const eligible = {
  status: "eligible" as const, sessionId: "authenticated-session",
  accountId: "owner-account", userId: "owner-user", productId: "render-dock",
  action: "OPEN" as const, entitlementId: "ent-1", licenseId: "lic-1",
  plan: "subscription" as const, rightsExpireNoLaterThan: until,
};
const input = (changes: Record<string, unknown> = {}) => ({
  accessToken: "token", pepper: "pepper", productId: "render-dock",
  platform: "windows" as const, architecture: "x64" as const,
  action: "OPEN" as const,
  proof: {
    registrationId: "registration-01", productId: "render-dock", action: "OPEN",
    evidence: {
      registrationId: "registration-01", registeredPublicKeyPem: edPem,
      proofPublicKeyPem: edPem, registrationValidUntil: until,
    },
  } as unknown as VerifiedAgentLeaseProof,
  ...changes,
});
const check = vi.mocked(checkAgentProductLeaseEligibilityInTransaction);
const prepare = vi.mocked(prepareLeaseClaimsWithVerifiedKey);

function fakeTransaction(rows: unknown[] = [keyRow()]) {
  const query = vi.fn().mockResolvedValue(rows);
  return { tx: { $queryRaw: query } as unknown as Prisma.TransactionClient, query };
}
async function denied(rows: unknown[], reason = "UNTRUSTED_MACHINE_KEY", changes: Record<string, unknown> = {}) {
  const { tx } = fakeTransaction(rows);
  expect(await prepareVerifiedProductLeaseInTransaction(tx, input(changes), now))
    .toEqual({ status: "denied", reason });
  expect(prepare).not.toHaveBeenCalled();
}

describe("transaction-scoped signed product lease preflight (NO JWS)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    check.mockResolvedValue(eligible);
    prepare.mockReturnValue({ status: "denied", reason: "STALE_KEY_PROOF" });
  });

  it("denies invalid token before looking up any registration", async () => {
    check.mockResolvedValue({ status: "invalid_token" });
    const { tx, query } = fakeTransaction();
    expect(await prepareVerifiedProductLeaseInTransaction(tx, input(), now))
      .toEqual({ status: "denied", reason: "INVALID_TOKEN" });
    expect(query).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("denies failed server-owned account/entitlement policy before key lookup", async () => {
    check.mockResolvedValue({ status: "denied", reason: "NO_ACTIVE_RIGHT" });
    const { tx, query } = fakeTransaction();
    expect(await prepareVerifiedProductLeaseInTransaction(tx, input(), now))
      .toEqual({ status: "denied", reason: "NOT_ELIGIBLE" });
    expect(query).not.toHaveBeenCalled();
  });

  it("forwards only token-derived eligibility context and locks the exact key row", async () => {
    const { tx, query } = fakeTransaction();
    const proof = input().proof;
    const result = await prepareVerifiedProductLeaseInTransaction(tx, input(), now);
    expect(result).toEqual({ status: "denied", reason: "STALE_KEY_PROOF" });
    expect(check).toHaveBeenCalledWith(tx, {
      accessToken: "token", pepper: "pepper", productId: "render-dock",
      platform: "windows", architecture: "x64", action: "OPEN",
    }, now);
    expect(query).toHaveBeenCalledTimes(1);
    const sql = (query.mock.calls[0]![0] as TemplateStringsArray).join(" ");
    expect(sql).toContain('FROM "AgentLeaseKeyRegistration"');
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain('"sessionId" = ');
    expect(prepare).toHaveBeenCalledWith(eligible, proof, now);
  });

  it("accepts persisted P-256/ES256 key without asserting hardware TPM", async () => {
    const { tx } = fakeTransaction([keyRow(ecPem)]);
    const p = input();
    const withP256 = { ...p, proof: { ...p.proof, evidence: {
      ...p.proof.evidence, registeredPublicKeyPem: ecPem, proofPublicKeyPem: ecPem,
    } } as VerifiedAgentLeaseProof };
    expect(await prepareVerifiedProductLeaseInTransaction(tx, withP256, now))
      .toEqual({ status: "denied", reason: "STALE_KEY_PROOF" });
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it("rejects missing, duplicated or unapproved registration", async () => {
    await denied([]);
    await denied([keyRow(), keyRow()]);
    await denied([keyRow(edPem, { status: "PENDING" })]);
    await denied([keyRow(edPem, { status: "REVOKED" })]);
  });

  for (const [label, changes] of [
    ["registration ID", { id: "other-key" }],
    ["session", { sessionId: "other-session" }],
    ["customer account", { accountId: "gift-purchaser" }],
    ["authenticated user", { userId: "other-user" }],
    ["public SPKI", { publicKeyPem: ecPem }],
    ["thumbprint", { keyThumbprint: "forged-thumbprint" }],
    ["algorithm", { keyAlgorithm: "ES256" }],
    ["registration validity", { validUntil: new Date(until.getTime() + 1000) }],
    ["already expired", { validUntil: now }],
  ] as const) {
    it("rejects changed persisted " + label, async () => {
      await denied([keyRow(edPem, changes)]);
    });
  }

  it("rejects absent, mismatched or externally formed proof evidence", async () => {
    await denied([keyRow()], "UNTRUSTED_MACHINE_KEY", { proof: null });
    await denied([keyRow()], "UNTRUSTED_MACHINE_KEY", {
      proof: { ...input().proof, registrationId: "other-registration" },
    });
    await denied([keyRow()], "UNTRUSTED_MACHINE_KEY", {
      proof: { ...input().proof, productId: "another-product" },
    });
    await denied([keyRow()], "UNTRUSTED_MACHINE_KEY", {
      proof: { ...input().proof, action: "USE" },
    });
  });

  it("fails closed on malformed clock before query or signer preparation", async () => {
    const { tx, query } = fakeTransaction();
    expect(await prepareVerifiedProductLeaseInTransaction(
      tx, input(), new Date(Number.NaN),
    )).toEqual({ status: "denied", reason: "INVALID_CONTEXT" });
    expect(query).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });
});
