import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_PRODUCT_LEASE_SCHEMA,
} from "@bke/licensing/contracts/account-product-lease.contract";
import {
  issueAccountProductLeaseJws,
  verifyAccountProductLeaseJws,
} from "@bke/licensing/providers/ed25519-account-product-lease";
import {
  prepareAccountProductLeaseClaims,
} from "@/apps/web/agent-sessions/product-lease-issuance-plan";
import type {
  ProductLeaseEligibilityDecision,
} from "@/apps/web/agent-sessions/product-lease-eligibility-policy";

const URL = "https://github.com/jan2xo/bke-libraries-typescript/releases/download/licensing-v0.10.0/bke-licensing-0.10.0.tgz";
const SHA512 = "sha512-3cumWOHW687GE1hPcCeCV2t7w69pQt7qssxLkZY2zHkYHb/tUyF+bdMn7CkL6UuZa5L1YEPtRuCLZP63TO5vlw==";
const now = new Date("2026-11-12T07:00:00.000Z");
const after = (ms: number) => new Date(now.getTime() + ms);
const before = (ms: number) => new Date(now.getTime() - ms);

// Only disposable test-generated private material; no production signer is
// loaded, stored, configured or exercised by this consumer compatibility test.
const machine = generateKeyPairSync("ed25519");
const signer = generateKeyPairSync("ed25519");
const machinePublicPem = machine.publicKey.export({ type: "spki", format: "pem" }).toString();
const signerPublicPem = signer.publicKey.export({ type: "spki", format: "pem" }).toString();
const signerPrivatePem = signer.privateKey.export({ type: "pkcs8", format: "pem" }).toString();

function prepare() {
  const eligibility: ProductLeaseEligibilityDecision = {
    status: "eligible",
    sessionId: "test-verified-agent-session",
    accountId: "test-account",
    userId: "test-user",
    productId: "bke-render-dock",
    action: "OPEN",
    entitlementId: "test-entitlement",
    licenseId: "test-license",
    plan: "subscription",
    rightsExpireNoLaterThan: after(3600_000),
  };
  return prepareAccountProductLeaseClaims(
    eligibility,
    {
      registrationId: "test-registration",
      registrationState: "ACTIVE",
      accountId: eligibility.accountId,
      userId: eligibility.userId,
      agentSessionId: eligibility.sessionId,
      registeredPublicKeyPem: machinePublicPem,
      proofPublicKeyPem: machinePublicPem,
      proofState: "VERIFIED",
      proofVerifiedAt: before(1000),
      registrationValidUntil: after(3600_000),
      claimedKeyProtection: "software",
    },
    now,
  );
}

describe("Digital Solutions immutable @bke/licensing 0.10.0 consumer", () => {
  it("locks both npm manifests to the original published JWS-capable tarball and SHA512", () => {
    const manifest = JSON.parse(readFileSync("package.json", "utf8"));
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
    const installed = JSON.parse(readFileSync("node_modules/@bke/licensing/package.json", "utf8"));
    const record = lock.packages["node_modules/@bke/licensing"];

    expect(manifest.dependencies["@bke/licensing"]).toBe(URL);
    expect(lock.packages[""].dependencies["@bke/licensing"]).toBe(URL);
    expect(record).toMatchObject({
      version: "0.10.0",
      resolved: URL,
      integrity: SHA512,
      dependencies: { pg: "^8.16.3", semver: "7.8.5" },
    });
    expect(installed.name).toBe("@bke/licensing");
    expect(installed.version).toBe("0.10.0");
    expect(installed.exports["./providers/*"]).toBe("./providers/*.ts");
  });

  it("signs DS prepared L3 claims with the installed immutable library and verifies exact trusted context", () => {
    const prepared = prepare();
    expect(prepared.status).toBe("ready_to_sign");
    if (prepared.status !== "ready_to_sign") throw Error("TEST_PREPARATION_DENIED");
    expect(prepared.claims.schema).toBe(ACCOUNT_PRODUCT_LEASE_SCHEMA);
    expect(prepared.claims.allowedActions).toEqual(["OPEN"]);
    expect(prepared.claims.keyProtection).toBe("software");

    const kid = "disposable-test-key";
    const jws = issueAccountProductLeaseJws(prepared.claims, {
      kid, privateKeyPem: signerPrivatePem,
    });
    expect(jws.split(".")).toHaveLength(3);

    const trusted = new Map([[kid, { publicKeyPem: signerPublicPem, state: "ACTIVE" as const }]]);
    const expected = {
      issuer: "BKE Digital Solutions",
      audience: "bke-product",
      accountId: prepared.claims.accountId,
      userId: prepared.claims.userId,
      productId: prepared.claims.productId,
      agentSessionId: prepared.claims.agentSessionId,
      agentKeyThumbprint: prepared.claims.agentKeyThumbprint,
      action: "OPEN" as const,
      now,
    };
    const verification = verifyAccountProductLeaseJws(jws, trusted, expected);
    expect(verification.ok).toBe(true);
    if (verification.ok) {
      expect(verification.kid).toBe(kid);
      expect(verification.claims).toEqual(prepared.claims);
    }

    expect(verifyAccountProductLeaseJws(jws, trusted,
      { ...expected, action: "USE" })).toEqual({ ok: false, reason: "CLAIM_MISMATCH" });
    expect(verifyAccountProductLeaseJws(jws, trusted,
      { ...expected, agentSessionId: "another-session" }))
      .toEqual({ ok: false, reason: "CLAIM_MISMATCH" });
    expect(verifyAccountProductLeaseJws(jws, trusted,
      { ...expected, now: after(300_000) })).toEqual({ ok: false, reason: "EXPIRED" });
    expect(verifyAccountProductLeaseJws(jws, new Map(),
      expected)).toEqual({ ok: false, reason: "UNTRUSTED_KID" });
    expect(verifyAccountProductLeaseJws(jws,
      new Map([[kid, { publicKeyPem: signerPublicPem, state: "REVOKED" as const }]]),
      expected)).toEqual({ ok: false, reason: "UNTRUSTED_KID" });

    const parts = jws.split(".");
    const tampered = [parts[0], parts[1],
      (parts[2][0] === "A" ? "B" : "A") + parts[2].slice(1)].join(".");
    expect(verifyAccountProductLeaseJws(tampered, trusted,
      expected)).toEqual({ ok: false, reason: "INVALID_SIGNATURE" });
  });
});
