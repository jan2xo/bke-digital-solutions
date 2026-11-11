import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  prepareAccountProductLeaseClaims,
  PRODUCT_LEASE_MAX_TTL_MS,
  type RegisteredAgentKeyProofEvidence,
} from "@/apps/web/agent-sessions/product-lease-issuance-plan";
import type {
  ProductLeaseEligibilityDecision,
} from "@/apps/web/agent-sessions/product-lease-eligibility-policy";

const now = new Date("2026-11-11T09:00:00.000Z");
const plus = (ms: number) => new Date(now.getTime() + ms);
const minus = (ms: number) => new Date(now.getTime() - ms);
const key1 = generateKeyPairSync("ed25519");
const key2 = generateKeyPairSync("ed25519");
const pub1 = key1.publicKey.export({ type: "spki", format: "pem" }).toString();
const pub2 = key2.publicKey.export({ type: "spki", format: "pem" }).toString();
const thumbprint = createHash("sha256").update(
  createPublicKey(pub1).export({ type: "spki", format: "der" }),
).digest("base64url");

function right(overrides: Record<string, unknown> = {}): ProductLeaseEligibilityDecision {
  return {
    status: "eligible",
    sessionId: "authenticated-agent-session",
    accountId: "recipient-account",
    userId: "recipient-user",
    productId: "render-dock",
    action: "OPEN",
    entitlementId: "entitlement-id",
    licenseId: "license-id",
    plan: "subscription",
    rightsExpireNoLaterThan: plus(3600_000),
    ...overrides,
  } as ProductLeaseEligibilityDecision;
}
function proof(overrides: Partial<RegisteredAgentKeyProofEvidence> = {}):
  RegisteredAgentKeyProofEvidence {
  return {
    registrationId: "registration-1",
    registrationState: "ACTIVE",
    accountId: "recipient-account",
    userId: "recipient-user",
    agentSessionId: "authenticated-agent-session",
    registeredPublicKeyPem: pub1,
    proofPublicKeyPem: pub1,
    proofState: "VERIFIED",
    proofVerifiedAt: minus(1500),
    registrationValidUntil: plus(3600_000),
    claimedKeyProtection: "software",
    ...overrides,
  };
}
function deny(
  e: ProductLeaseEligibilityDecision,
  p: RegisteredAgentKeyProofEvidence | null,
  reason: string,
  at = now,
) {
  expect(prepareAccountProductLeaseClaims(e, p, at))
    .toEqual({ status: "denied", reason });
}

describe("DS L3 source-only pre-signing product lease claims", () => {
  it("prepares exactly the pinned v1 JWS claim shape from eligible server-owned identity", () => {
    const r = prepareAccountProductLeaseClaims(right(), proof(), now);
    expect(r.status).toBe("ready_to_sign");
    if (r.status !== "ready_to_sign") throw Error("UNEXPECTED_DENIAL");
    expect(Object.keys(r.claims)).toEqual([
      "schema", "issuer", "audience", "leaseId", "accountId", "userId",
      "productId", "agentSessionId", "agentKeyThumbprint", "keyProtection",
      "plan", "allowedActions", "issuedAt", "refreshAfter", "expiresAt",
    ]);
    expect(r.claims).toMatchObject({
      schema: "bke.product-lease.v1",
      issuer: "BKE Digital Solutions",
      audience: "bke-product",
      accountId: "recipient-account",
      userId: "recipient-user",
      productId: "render-dock",
      agentSessionId: "authenticated-agent-session",
      agentKeyThumbprint: thumbprint,
      keyProtection: "software",
      plan: "subscription",
      allowedActions: ["OPEN"],
      issuedAt: now.toISOString(),
      refreshAfter: plus(150_000).toISOString(),
      expiresAt: plus(300_000).toISOString(),
    });
    expect(r.claims.leaseId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(Object.isFrozen(r.claims)).toBe(true);
    expect(Object.isFrozen(r.claims.allowedActions)).toBe(true);
  });

  it("generates a unique server-side leaseId on each preparation", () => {
    const a = prepareAccountProductLeaseClaims(right(), proof(), now);
    const b = prepareAccountProductLeaseClaims(right(), proof(), now);
    expect(a.status).toBe("ready_to_sign");
    expect(b.status).toBe("ready_to_sign");
    if (a.status === "ready_to_sign" && b.status === "ready_to_sign") {
      expect(a.claims.leaseId).not.toBe(b.claims.leaseId);
    }
  });

  it("limits hard expiry to the earliest underlying right deadline", () => {
    const r = prepareAccountProductLeaseClaims(
      right({ rightsExpireNoLaterThan: plus(30_000), plan: "trial" }),
      proof(), now,
    );
    expect(r.status).toBe("ready_to_sign");
    if (r.status === "ready_to_sign") {
      expect(r.claims.expiresAt).toBe(plus(30_000).toISOString());
      expect(r.claims.refreshAfter).toBe(plus(15_000).toISOString());
      expect(r.claims.plan).toBe("trial");
    }
  });

  it("caps by registration lifetime even when entitlement lasts longer", () => {
    const r = prepareAccountProductLeaseClaims(right(), proof({
      registrationValidUntil: plus(20_000),
    }), now);
    expect(r.status).toBe("ready_to_sign");
    if (r.status === "ready_to_sign") {
      expect(r.claims.expiresAt).toBe(plus(20_000).toISOString());
      expect(r.claims.refreshAfter).toBe(plus(10_000).toISOString());
    }
  });

  it("never treats a perpetual right as perpetual signed execution", () => {
    const r = prepareAccountProductLeaseClaims(
      right({ plan: "perpetual", rightsExpireNoLaterThan: null }),
      proof(), now,
    );
    expect(r.status).toBe("ready_to_sign");
    if (r.status === "ready_to_sign") {
      expect(r.claims.plan).toBe("perpetual");
      expect(Date.parse(r.claims.expiresAt) - now.getTime()).toBe(PRODUCT_LEASE_MAX_TTL_MS);
    }
  });

  it("does not grant USE implicitly when the eligible action is only OPEN", () => {
    const r = prepareAccountProductLeaseClaims(right({ action: "OPEN" }), proof(), now);
    expect(r.status).toBe("ready_to_sign");
    if (r.status === "ready_to_sign") expect(r.claims.allowedActions).toEqual(["OPEN"]);
  });

  it("preserves USE as an independent action, never bundling OPEN implicitly", () => {
    const r = prepareAccountProductLeaseClaims(right({ action: "USE" }), proof(), now);
    expect(r.status).toBe("ready_to_sign");
    if (r.status === "ready_to_sign") expect(r.claims.allowedActions).toEqual(["USE"]);
  });

  it("downgrades self-claimed TPM to software instead of claiming hardware attestation", () => {
    const r = prepareAccountProductLeaseClaims(right(), proof({
      claimedKeyProtection: "tpm",
    }), now);
    expect(r.status).toBe("ready_to_sign");
    if (r.status === "ready_to_sign") expect(r.claims.keyProtection).toBe("software");
  });

  it("rejects denied L2 authorization, regardless of valid key input", () => {
    deny({ status: "denied", reason: "NO_ACTIVE_RIGHT" }, proof(), "NOT_ELIGIBLE");
  });

  it("rejects absent machine registration", () => {
    deny(right(), null, "UNTRUSTED_MACHINE_KEY");
  });

  const badEvidence: readonly [string, Partial<RegisteredAgentKeyProofEvidence>][] = [
    ["revoked key registration", { registrationState: "REVOKED" }],
    ["pending key registration", { registrationState: "PENDING" }],
    ["unverified nonce response", { proofState: "UNVERIFIED" }],
    ["missing registration ID", { registrationId: "" }],
    ["wrong account", { accountId: "purchaser-account" }],
    ["wrong user", { userId: "other-user" }],
    ["wrong session", { agentSessionId: "old-agent-session" }],
    ["different ed25519 proof key", { proofPublicKeyPem: pub2 }],
    ["invalid registered key", { registeredPublicKeyPem: "not-a-public-key" }],
    ["invalid proof key", { proofPublicKeyPem: "not-a-public-key" }],
    ["unknown asserted protection", { claimedKeyProtection: "unknown" as "software" }],
  ];
  for (const [label, mutation] of badEvidence) {
    it("rejects " + label, () => {
      deny(right(), proof(mutation), "UNTRUSTED_MACHINE_KEY");
    });
  }

  it("rejects RSA public key even if both evidence fields match", () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey
      .export({ type: "spki", format: "pem" }).toString();
    deny(right(), proof({ registeredPublicKeyPem: rsa, proofPublicKeyPem: rsa }),
      "UNTRUSTED_MACHINE_KEY");
  });

  it("rejects proof older than 30 seconds", () => {
    deny(right(), proof({ proofVerifiedAt: minus(30_001) }), "STALE_KEY_PROOF");
  });

  it("accepts proof exactly at the freshness limit", () => {
    expect(prepareAccountProductLeaseClaims(right(), proof({
      proofVerifiedAt: minus(30_000),
    }), now).status).toBe("ready_to_sign");
  });

  it("rejects proof issued in the future", () => {
    deny(right(), proof({ proofVerifiedAt: plus(1) }), "STALE_KEY_PROOF");
  });

  it("rejects invalid proof time", () => {
    deny(right(), proof({ proofVerifiedAt: new Date("invalid") }), "STALE_KEY_PROOF");
  });

  it("rejects invalid registration expiry timestamp", () => {
    deny(right(), proof({ registrationValidUntil: new Date("invalid") }), "STALE_KEY_PROOF");
  });

  it("rejects expired Agent key registration at exactly now", () => {
    deny(right(), proof({ registrationValidUntil: now }), "UNTRUSTED_MACHINE_KEY");
  });

  it("rejects stale/expired entitlement source at exactly now", () => {
    deny(right({ rightsExpireNoLaterThan: now }), proof(), "RIGHTS_EXPIRE_TOO_SOON");
  });

  it("rejects a right with less than one second of remaining authority", () => {
    deny(right({ rightsExpireNoLaterThan: plus(900) }), proof(), "RIGHTS_EXPIRE_TOO_SOON");
  });

  it("rejects an Agent registration expiring too soon", () => {
    deny(right(), proof({ registrationValidUntil: plus(1000) }), "RIGHTS_EXPIRE_TOO_SOON");
  });

  it("rejects invalid wall clock", () => {
    deny(right(), proof(), "INVALID_CONTEXT", new Date("invalid"));
  });

  it("rejects invalid rights expiry timestamp", () => {
    deny(right({ rightsExpireNoLaterThan: new Date("invalid") }), proof(), "INVALID_CONTEXT");
  });

  it("rejects malformed caller-discovered product action", () => {
    deny(right({ action: "INSTALL" }), proof(), "INVALID_CONTEXT");
  });

  it("rejects unrecognized plan", () => {
    deny(right({ plan: "free_forever" }), proof(), "INVALID_CONTEXT");
  });

  it("rejects missing server-session identity, account and product", () => {
    for (const key of ["sessionId", "accountId", "userId", "productId",
      "entitlementId", "licenseId"]) {
      deny(right({ [key]: "" }), proof(), "INVALID_CONTEXT");
    }
  });

  it("does not import an unpublished signer, create a route, or load secrets", () => {
    const source = readFileSync("apps/web/agent-sessions/product-lease-issuance-plan.ts", "utf8");
    expect(source).not.toContain("issueAccountProductLeaseJws(");
    expect(source).not.toContain("createPrivateKey");
    expect(source).not.toContain("AGENT_SIGNING_PRIVATE_KEY");
    expect(source).not.toContain("process.env");
    expect(source).not.toContain("V3_");
    expect(source).toContain("rightsExpireNoLaterThan");
    expect(source).toContain("registrationValidUntil");
    expect(source).toContain("proofVerifiedAt");
    expect(source).toContain("keyProtection: \"software\"");
  });
});
