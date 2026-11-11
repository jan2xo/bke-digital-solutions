import "dotenv/config";
import { randomUUID, generateKeyPairSync, sign, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../platform/host/generated/prisma/client";
import { hashAgentAccessToken } from "@/apps/web/agent-sessions/material";
import {
  beginAgentKeyEnrollment,
  beginAgentLeaseKeyChallenge,
  verifyAgentKeyChallenge,
  revokeAgentLeaseKey,
  prepareLeaseClaimsWithVerifiedKey,
  type KeyProofChallenge,
} from "@/apps/web/agent-sessions/agent-key-proof-authority";
import { readAgentKeyRegistrationState } from "@/apps/web/agent-sessions/agent-key-reconciliation";
import type { ProductLeaseEligibilityDecision } from "@/apps/web/agent-sessions/product-lease-eligibility-policy";

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});
const pepper = "disposable-agent-key-proof-strong-pepper-2026";
const k1 = generateKeyPairSync("ed25519");
const k2 = generateKeyPairSync("ed25519");
const p256 = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const p256PublicPem = p256.publicKey.export({ type: "spki", format: "pem" }).toString();
const publicPem = k1.publicKey.export({ type: "spki", format: "pem" }).toString();
const signFor = (challenge: KeyProofChallenge, key = k1.privateKey) =>
  sign(null, Buffer.from(challenge.messageBase64url, "base64url"), key)
    .toString("base64url");

describe("DS Agent machine-key nonce PoP authority (real PostgreSQL + Ed25519)", { concurrent: false }, () => {
  let sessionId = "", accountId = "", userId = "", deviceId = "";
  let foreignAccountId = "", foreignSessionId = "", foreignUserId = "";
  let accessToken = "", foreignToken = "", registrationId = "";
  let enrollment: KeyProofChallenge;

  async function seedSession(user: string, account: string) {
    const id = randomUUID(), authId = randomUUID();
    const deviceId = `bke-device-test-${randomUUID()}`;
    const token = `bke-access-test-${randomUUID()}`;
    const at = new Date(), accessExpiry = new Date(at.getTime() + 15 * 60_000);
    const refreshExpiry = new Date(at.getTime() + 30 * 24 * 60 * 60_000);
    await db.$executeRaw`
      INSERT INTO "AgentDeviceAuthorization" (
        "id", "deviceCodeHash", "userCodeHash", "deviceId", "platform",
        "architecture", "status", "expiresAt", "pollIntervalSeconds",
        "approvedByUserId", "approvedAccountId", "approvedAt", "consumedAt",
        "handoffExpiresAt", "sessionId"
      ) VALUES (
        ${authId}, ${randomUUID()}, ${randomUUID()}, ${deviceId},
        'windows', 'x64', 'CONSUMED', ${accessExpiry}, 5,
        ${user}, ${account}, ${at}, ${at}, ${accessExpiry}, ${id}
      )
    `;
    await db.$executeRaw`
      INSERT INTO "AgentAccountSession" (
        "id", "deviceAuthorizationId", "userId", "accountId", "deviceId",
        "accessTokenHash", "accessExpiresAt", "refreshExpiresAt"
      ) VALUES (
        ${id}, ${authId}, ${user}, ${account}, ${deviceId},
        ${hashAgentAccessToken(token, pepper)}, ${accessExpiry}, ${refreshExpiry}
      )
    `;
    return { id, token, deviceId };
  }

  beforeAll(async () => {
    const suffix = randomUUID().slice(0, 8);
    const u = await db.user.create({ data: {
      email: `proof-owner-${suffix}@bke.test`, emailVerified: new Date(),
      ownedAccounts: { create: {
        type: "INDIVIDUAL", displayName: "PoP Proof Owner",
        billingEmail: `proof-owner-${suffix}@bke.test`,
      } },
    }, include: { ownedAccounts: true } });
    userId = u.id;
    accountId = u.ownedAccounts[0]!.id;

    const foreign = await db.user.create({ data: {
      email: `proof-other-${suffix}@bke.test`, emailVerified: new Date(),
      ownedAccounts: { create: {
        type: "INDIVIDUAL", displayName: "PoP Other Owner",
        billingEmail: `proof-other-${suffix}@bke.test`,
      } },
    }, include: { ownedAccounts: true } });
    foreignAccountId = foreign.ownedAccounts[0]!.id;
    foreignUserId = foreign.id;

    const own = await seedSession(userId, accountId);
    const other = await seedSession(foreign.id, foreignAccountId);
    sessionId = own.id;
    accessToken = own.token;
    deviceId = own.deviceId;
    foreignToken = other.token;
    foreignSessionId = other.id;
  });
  afterAll(() => db.$disconnect());

  async function registrationState(token = accessToken, id?: string) {
    return db.$transaction(tx => readAgentKeyRegistrationState(tx, {
      accessToken: token, pepper, registrationId: id,
    }), { isolationLevel: "Serializable" });
  }
  async function begin() {
    return db.$transaction(tx => beginAgentKeyEnrollment(tx, {
      accessToken, pepper, publicKeyPem: publicPem,
    }), { isolationLevel: "Serializable" });
  }
  async function lease(productId = "render-dock", action: "OPEN" | "USE" = "OPEN") {
    return db.$transaction(tx => beginAgentLeaseKeyChallenge(tx, {
      accessToken, pepper, registrationId, productId, action,
    }), { isolationLevel: "Serializable" });
  }
  async function verifyProof(
    challenge: KeyProofChallenge, signature = signFor(challenge),
    token = accessToken,
    time = new Date(),
  ) {
    return db.$transaction(tx => verifyAgentKeyChallenge(tx, {
      accessToken: token, pepper, challengeId: challenge.challengeId,
      messageBase64url: challenge.messageBase64url,
      signatureBase64url: signature,
    }, time), { isolationLevel: "Serializable" });
  }
  function eligible(
    productId = "render-dock", action: "OPEN" | "USE" = "OPEN",
  ): ProductLeaseEligibilityDecision {
    return {
      status: "eligible", sessionId, accountId, userId, productId, action,
      entitlementId: "disposable-source-entitlement-only",
      licenseId: "disposable-source-license-only",
      plan: "trial",
      rightsExpireNoLaterThan: new Date(Date.now() + 45_000),
    };
  }

  it("refuses no bearer authority and RSA source keys before persistence", async () => {
    const noToken = await db.$transaction(tx => beginAgentKeyEnrollment(tx, {
      accessToken: "invalid-agent-token", pepper, publicKeyPem: publicPem,
    }), { isolationLevel: "Serializable" });
    expect(noToken).toEqual({ status: "denied", reason: "INVALID_TOKEN" });
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 })
      .publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(await db.$transaction(tx => beginAgentKeyEnrollment(tx, {
      accessToken, pepper, publicKeyPem: rsa,
    }), { isolationLevel: "Serializable" })).toEqual({
      status: "denied", reason: "INVALID_KEY",
    });
  });

  it("creates PENDING key and unpredictable, single-use server nonce for true authenticated session", async () => {
    const started = await begin();
    expect(started.status).toBe("challenge");
    if (started.status !== "challenge") throw Error("ENROLL_SETUP_FAILED");
    enrollment = started;
    registrationId = started.registrationId;
    const row = await db.$queryRaw<Array<{
      sessionId: string; accountId: string; userId: string; deviceId: string;
      keyProtection: string; status: string;
    }>>`
      SELECT "sessionId", "accountId", "userId", "deviceId",
             "keyProtection", "status"
        FROM "AgentLeaseKeyRegistration" WHERE "id" = ${registrationId}
    `;
    expect(row[0]).toMatchObject({
      sessionId, accountId, userId, deviceId,
      keyProtection: "software", status: "PENDING",
    });
    const message = Buffer.from(enrollment.messageBase64url, "base64url").toString("utf8");
    expect(message).toContain("bke.agent-key-proof.v1");
    expect(message).toContain(sessionId);
    expect(message).toContain(registrationId);
    expect(message).toContain(deviceId);
    expect(message).toContain("\nENROLL\n");
    expect(message.split("\n").at(-1)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await begin()).toEqual({ status: "denied", reason: "REGISTRATION_CONFLICT" });
  });

  it("reconciles pending registration within exact authenticated session", async () => {
    expect(await registrationState()).toMatchObject({
      status: "registration", registrationId, registrationState: "pending",
      keyProtection: "software", keyAlgorithm: "EdDSA",
    });
    expect(await registrationState(foreignToken, registrationId)).toEqual({ status: "none" });
    expect(await registrationState("invalid-token", registrationId))
      .toEqual({ status: "denied", reason: "INVALID_TOKEN" });
    expect(await registrationState(accessToken, randomUUID())).toEqual({ status: "none" });
  });

  it("does not let another valid Agent bearer token consume this challenge", async () => {
    expect(await verifyProof(enrollment, signFor(enrollment), foreignToken)).toEqual({
      status: "denied", reason: "INVALID_CHALLENGE",
    });
    const row = await db.$queryRaw<Array<{ consumedAt: Date | null }>>`
      SELECT "consumedAt" FROM "AgentLeaseKeyChallenge" WHERE "id" = ${enrollment.challengeId}
    `;
    expect(row[0]?.consumedAt).toBeNull();
  });

  it("only a correct real Ed25519 private-key signature activates the registration", async () => {
    const a = await verifyProof(enrollment);
    expect(a).toEqual({ status: "enrolled", registrationId });
    expect(await verifyProof(enrollment)).toEqual({
      status: "denied", reason: "INVALID_CHALLENGE",
    });
    const row = await db.$queryRaw<Array<{
      status: string; activatedAt: Date | null;
    }>>`
      SELECT "status", "activatedAt" FROM "AgentLeaseKeyRegistration"
       WHERE "id" = ${registrationId}
    `;
    expect(row[0]?.status).toBe("ACTIVE");
    expect(row[0]?.activatedAt).not.toBeNull();
    expect(await db.auditLog.count({
      where: { targetId: registrationId, action: "AGENT_LEASE_KEY_ENROLLED" },
    })).toBe(1);
  });

  it("recovers an ACTIVE receipt from DS after local acknowledgment loss", async () => {
    expect(await registrationState()).toMatchObject({
      status: "registration", registrationId, registrationState: "active", keyAlgorithm: "EdDSA",
    });
    expect(await registrationState(accessToken, registrationId)).toMatchObject({
      status: "registration", registrationId, registrationState: "active",
    });
  });

  it("burns a bad-signature LEASE nonce permanently and cannot replay correct signature", async () => {
    const c = await lease();
    expect(c.status).toBe("challenge");
    if (c.status !== "challenge") throw Error("LEASE_SETUP_FAILED");
    expect(await verifyProof(c, signFor(c, k2.privateKey))).toEqual({
      status: "denied", reason: "BAD_SIGNATURE",
    });
    expect(await verifyProof(c)).toEqual({
      status: "denied", reason: "INVALID_CHALLENGE",
    });
    const row = await db.$queryRaw<Array<{ consumedAt: Date; verifiedAt: Date | null }>>`
      SELECT "consumedAt", "verifiedAt" FROM "AgentLeaseKeyChallenge"
       WHERE "id" = ${c.challengeId}
    `;
    expect(row[0]?.consumedAt).not.toBeNull();
    expect(row[0]?.verifiedAt).toBeNull();
  });

  it("rejects valid signature presented with a changed challenge payload", async () => {
    const c = await lease();
    expect(c.status).toBe("challenge");
    if (c.status !== "challenge") throw Error("LEASE_SETUP_FAILED");
    const modified = Buffer.from(c.messageBase64url, "base64url");
    modified[modified.length - 1] = modified[modified.length - 1]! === 65 ? 66 : 65;
    const rejection = await db.$transaction(tx => verifyAgentKeyChallenge(tx, {
      accessToken, pepper, challengeId: c.challengeId,
      messageBase64url: modified.toString("base64url"),
      signatureBase64url: signFor(c),
    }), { isolationLevel: "Serializable" });
    expect(rejection).toEqual({ status: "denied", reason: "BAD_SIGNATURE" });
    expect(await verifyProof(c)).toEqual({ status: "denied", reason: "INVALID_CHALLENGE" });
  });

  it("verifies fresh LEASE proof, mints nonserializable trusted evidence and prepares short bounded claims", async () => {
    const c = await lease();
    expect(c.status).toBe("challenge");
    if (c.status !== "challenge") throw Error("LEASE_SETUP_FAILED");
    const verification = await verifyProof(c);
    expect(verification.status).toBe("verified");
    if (verification.status !== "verified") throw Error("LEASE_VERIFICATION_FAILED");
    expect(verification.proof.evidence).toMatchObject({
      registrationId, accountId, userId, agentSessionId: sessionId,
      proofState: "VERIFIED", claimedKeyProtection: "software",
    });
    expect(JSON.stringify(verification.proof)).not.toContain("trusted");
    const claims = prepareLeaseClaimsWithVerifiedKey(eligible(), verification.proof);
    expect(claims.status).toBe("ready_to_sign");
    if (claims.status !== "ready_to_sign") throw Error("PRE_SIGNING_DENIED");
    expect(claims.claims.agentSessionId).toBe(sessionId);
    expect(claims.claims.allowedActions).toEqual(["OPEN"]);
    expect(claims.claims.keyProtection).toBe("software");
    expect(prepareLeaseClaimsWithVerifiedKey(eligible(), verification.proof))
      .toEqual({ status: "denied", reason: "UNTRUSTED_MACHINE_KEY" });
    expect(Date.parse(claims.claims.expiresAt)).toBeLessThanOrEqual(Date.now() + 45_000);
    expect(await verifyProof(c)).toEqual({ status: "denied", reason: "INVALID_CHALLENGE" });
    expect(prepareLeaseClaimsWithVerifiedKey(eligible("air-stack"), verification.proof))
      .toEqual({ status: "denied", reason: "UNTRUSTED_MACHINE_KEY" });
    expect(prepareLeaseClaimsWithVerifiedKey(eligible("render-dock", "USE"), verification.proof))
      .toEqual({ status: "denied", reason: "UNTRUSTED_MACHINE_KEY" });
    expect(prepareLeaseClaimsWithVerifiedKey(eligible(), JSON.parse(JSON.stringify(verification.proof))))
      .toEqual({ status: "denied", reason: "UNTRUSTED_MACHINE_KEY" });
  });

  it("refuses expired nonce on the exact expiry boundary without accepting Ed25519 signature", async () => {
    const c = await lease();
    expect(c.status).toBe("challenge");
    if (c.status !== "challenge") throw Error("LEASE_SETUP_FAILED");
    const result = await verifyProof(c, signFor(c), accessToken, c.expiresAt);
    expect(result).toEqual({ status: "denied", reason: "INVALID_CHALLENGE" });
  });

  it("keeps committed public-only cross-language EdDSA/ES256 golden signatures immutable", () => {
    const golden = JSON.parse(readFileSync(
      "certification/fixtures/agent-machine-key-golden-vectors.json", "utf8",
    )) as {
      protocol: string; message_utf8: string; message_base64url: string;
      vectors: Array<{ algorithm: "EdDSA" | "ES256"; signature_encoding: string;
        public_key_pem: string; signature_base64url: string }>;
      negative: { es256_der_signature_base64url: string;
        unsupported_p384_public_key_pem: string };
    };
    const bytes = Buffer.from(golden.message_utf8, "utf8");
    expect(golden.protocol).toBe("bke.agent-key-proof.v1");
    expect(bytes.toString("base64url")).toBe(golden.message_base64url);
    expect(golden.vectors.map(x => x.algorithm)).toEqual(["EdDSA", "ES256"]);
    for (const vector of golden.vectors) {
      const signature = Buffer.from(vector.signature_base64url, "base64url");
      expect(signature).toHaveLength(64);
      expect(verify(
        vector.algorithm === "ES256" ? "sha256" : null,
        bytes,
        vector.algorithm === "ES256" ? {
          key: vector.public_key_pem, dsaEncoding: "ieee-p1363" as const,
        } : vector.public_key_pem,
        signature,
      )).toBe(true);
    }
    expect(Buffer.from(golden.negative.es256_der_signature_base64url, "base64url"))
      .not.toHaveLength(64);
    expect(golden.negative.unsupported_p384_public_key_pem)
      .toContain("BEGIN PUBLIC KEY");
  });

  it("rejects unsupported P-384 source key and stores real ES256 algorithm for P-256", async () => {
    const wrongCurve = generateKeyPairSync("ec", { namedCurve: "secp384r1" })
      .publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(await db.$transaction(tx => beginAgentKeyEnrollment(tx, {
      accessToken: foreignToken, pepper, publicKeyPem: wrongCurve,
    }), { isolationLevel: "Serializable" })).toEqual({
      status: "denied", reason: "INVALID_KEY",
    });
    const started = await db.$transaction(tx => beginAgentKeyEnrollment(tx, {
      accessToken: foreignToken, pepper, publicKeyPem: p256PublicPem,
    }), { isolationLevel: "Serializable" });
    expect(started.status).toBe("challenge");
    if (started.status !== "challenge") throw Error("ES256_ENROLL_SETUP_FAILED");
    const registration = await db.$queryRaw<Array<{
      keyAlgorithm: string; keyProtection: string;
    }>>`
      SELECT "keyAlgorithm","keyProtection"
      FROM "AgentLeaseKeyRegistration" WHERE "id" = ${started.registrationId}
    `;
    expect(registration[0]).toEqual({
      keyAlgorithm: "ES256", keyProtection: "software",
    });
    expect(await registrationState(foreignToken, started.registrationId)).toMatchObject({
      status: "registration", registrationState: "pending",
      keyAlgorithm: "ES256", keyProtection: "software",
    });
    const signature = sign("sha256", Buffer.from(started.messageBase64url, "base64url"), {
      key: p256.privateKey, dsaEncoding: "ieee-p1363",
    }).toString("base64url");
    expect(Buffer.from(signature, "base64url")).toHaveLength(64);
    expect(await db.$transaction(tx => verifyAgentKeyChallenge(tx, {
      accessToken: foreignToken, pepper, challengeId: started.challengeId,
      messageBase64url: started.messageBase64url, signatureBase64url: signature,
    }), { isolationLevel: "Serializable" })).toEqual({
      status: "enrolled", registrationId: started.registrationId,
    });

    const invalidChallenge = await db.$transaction(tx => beginAgentLeaseKeyChallenge(tx, {
      accessToken: foreignToken, pepper, registrationId: started.registrationId,
      productId: "render-dock", action: "OPEN",
    }), { isolationLevel: "Serializable" });
    expect(invalidChallenge.status).toBe("challenge");
    if (invalidChallenge.status !== "challenge") throw Error("ES256_INVALID_SETUP_FAILED");
    const wrongSig = sign("sha256", Buffer.from(invalidChallenge.messageBase64url, "base64url"), {
      key: generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey,
      dsaEncoding: "ieee-p1363",
    }).toString("base64url");
    expect(await db.$transaction(tx => verifyAgentKeyChallenge(tx, {
      accessToken: foreignToken, pepper, challengeId: invalidChallenge.challengeId,
      messageBase64url: invalidChallenge.messageBase64url, signatureBase64url: wrongSig,
    }), { isolationLevel: "Serializable" })).toEqual({
      status: "denied", reason: "BAD_SIGNATURE",
    });
    const challenge = await db.$transaction(tx => beginAgentLeaseKeyChallenge(tx, {
      accessToken: foreignToken, pepper, registrationId: started.registrationId,
      productId: "render-dock", action: "OPEN",
    }), { isolationLevel: "Serializable" });
    expect(challenge.status).toBe("challenge");
    if (challenge.status !== "challenge") throw Error("ES256_LEASE_SETUP_FAILED");
    const valid = sign("sha256", Buffer.from(challenge.messageBase64url, "base64url"), {
      key: p256.privateKey, dsaEncoding: "ieee-p1363",
    }).toString("base64url");
    const result = await db.$transaction(tx => verifyAgentKeyChallenge(tx, {
      accessToken: foreignToken, pepper, challengeId: challenge.challengeId,
      messageBase64url: challenge.messageBase64url, signatureBase64url: valid,
    }), { isolationLevel: "Serializable" });
    expect(result.status).toBe("verified");
    if (result.status !== "verified") throw Error("ES256_LEASE_PROOF_FAILED");
    const expected = {
      ...eligible(), sessionId: foreignSessionId,
      userId: foreignUserId, accountId: foreignAccountId,
    } as ProductLeaseEligibilityDecision;
    const claims = prepareLeaseClaimsWithVerifiedKey(expected, result.proof);
    expect(claims.status).toBe("ready_to_sign");
    if (claims.status !== "ready_to_sign") throw Error("ES256_LEASE_PREPARATION_FAILED");
    // A P-256 signature does not by itself demonstrate TPM origin.
    expect(claims.claims.keyProtection).toBe("software");
  });

  it("allows explicit terminal revocation, cancels all unspent nonce challenges and denies future use", async () => {
    const pending = await lease("render-dock", "USE");
    expect(pending.status).toBe("challenge");
    if (pending.status !== "challenge") throw Error("LEASE_SETUP_FAILED");
    const result = await db.$transaction(tx => revokeAgentLeaseKey(tx, {
      accessToken, pepper, registrationId,
    }), { isolationLevel: "Serializable" });
    expect(result).toEqual({ status: "revoked" });
    expect(await verifyProof(pending)).toEqual({
      status: "denied", reason: "INVALID_CHALLENGE",
    });
    expect(await lease()).toEqual({ status: "denied", reason: "KEY_REVOKED" });
    expect(await db.$transaction(tx => revokeAgentLeaseKey(tx, {
      accessToken, pepper, registrationId,
    }), { isolationLevel: "Serializable" })).toEqual({ status: "already_revoked" });
    const rows = await db.$queryRaw<Array<{ status: string; revokedAt: Date | null }>>`
      SELECT "status", "revokedAt" FROM "AgentLeaseKeyRegistration"
       WHERE "id" = ${registrationId}
    `;
    expect(rows[0]?.status).toBe("REVOKED");
    expect(await registrationState()).toEqual({ status: "none" });
    expect(await registrationState(accessToken, registrationId)).toMatchObject({
      status: "registration", registrationId, registrationState: "revoked",
      keyAlgorithm: "EdDSA",
    });
    expect(rows[0]?.revokedAt).not.toBeNull();
    expect(await db.auditLog.count({
      where: { targetId: registrationId, action: "AGENT_LEASE_KEY_REVOKED" },
    })).toBe(1);
  });
});
