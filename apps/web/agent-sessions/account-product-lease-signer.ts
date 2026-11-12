import "server-only";

import { createPrivateKey, createPublicKey, sign, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@/platform/persistence/generated/prisma/client";
import { issueAccountProductLeaseJws } from "@bke/licensing/providers/ed25519-account-product-lease";
import type { AccountProductLeaseClaims } from "@bke/licensing/contracts/account-product-lease.contract";

const KID = /^[A-Za-z0-9._-]{1,128}$/;
type RegistryRow = Readonly<{
  kid: string;
  publicKeyPem: string;
  privateKeyReference: string;
  status: "ACTIVE" | "STAGED" | "VERIFY_ONLY" | "REVOKED";
}>;

/** Separate from commercial license keys; NEVER log the keyset. */
function privatePemFromKeyset(raw: string | undefined, row: RegistryRow): string {
  if (!KID.test(row.kid) || row.privateKeyReference !== "keyset:" + row.kid)
    throw new Error("ACCOUNT_PRODUCT_SIGNER_IDENTITY_INVALID");
  if (typeof raw !== "string" || raw.length < 64 || raw.length > 100_000)
    throw new Error("ACCOUNT_PRODUCT_SIGNER_UNAVAILABLE");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error("ACCOUNT_PRODUCT_SIGNER_UNAVAILABLE"); }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object")
    throw new Error("ACCOUNT_PRODUCT_SIGNER_UNAVAILABLE");
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).length > 12 ||
      Object.keys(record).some(key => !KID.test(key)) ||
      typeof record[row.kid] !== "string")
    throw new Error("ACCOUNT_PRODUCT_SIGNER_UNAVAILABLE");
  const pem = record[row.kid] as string;
  if (pem.length > 8192 || !pem.startsWith(["-----BEGIN", "PRIVATE KEY-----"].join(" ")))
    throw new Error("ACCOUNT_PRODUCT_SIGNER_UNAVAILABLE");
  try {
    const privateKey = createPrivateKey(pem);
    if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("INVALID_KEY");
    const derived = createPublicKey(privateKey)
      .export({ type: "spki", format: "der" }) as Buffer;
    const canonical = createPublicKey(row.publicKeyPem);
    if (canonical.asymmetricKeyType !== "ed25519") throw new Error("INVALID_PUB");
    const expected = canonical.export({ type: "spki", format: "der" }) as Buffer;
    if (derived.length !== expected.length || !timingSafeEqual(derived, expected))
      throw new Error("MISMATCH");
  } catch {
    throw new Error("ACCOUNT_PRODUCT_SIGNER_KEY_MISMATCH");
  }
  return pem;
}

/** Lock the active signer through the end of the issuance transaction. */
export async function signAccountProductLeaseInTransaction(
  tx: Prisma.TransactionClient,
  claims: AccountProductLeaseClaims,
  keyset: string | undefined,
): Promise<Readonly<{ kid: string; jws: string }>> {
  const rows = await tx.$queryRaw<RegistryRow[]>`
    SELECT "kid", "publicKeyPem", "privateKeyReference", "status"
      FROM "AccountProductLeaseSigningKey"
     WHERE "status" = 'ACTIVE'
     FOR SHARE
  `;
  if (rows.length !== 1 || rows[0]!.status !== "ACTIVE")
    throw new Error("ACCOUNT_PRODUCT_SIGNER_NOT_UNIQUE");
  const active = rows[0]!;
  const privateKeyPem = privatePemFromKeyset(keyset, active);
  const jws = issueAccountProductLeaseJws(claims, {
    kid: active.kid, privateKeyPem,
  });
  return Object.freeze({ kid: active.kid, jws });
}

/**
 * Trusted internal admin operation, deliberately not HTTP-exposed.
 * Caller must authenticate admin and own one SERIALIZABLE transaction.
 * Old ACTIVE becomes VERIFY_ONLY, STAGED becomes ACTIVE. Revocation terminal.
 */
export async function rotateAccountProductLeaseSigningKeyInTransaction(
  tx: Prisma.TransactionClient,
  input: Readonly<{ newKid: string; adminUserId: string; keyset: string | undefined }>,
): Promise<void> {
  if (!KID.test(input.newKid) || !input.adminUserId)
    throw new Error("ACCOUNT_PRODUCT_SIGNER_ROTATION_INVALID");
  const active = await tx.$queryRaw<RegistryRow[]>`
    SELECT "kid", "publicKeyPem", "privateKeyReference", "status"
      FROM "AccountProductLeaseSigningKey" WHERE "status" = 'ACTIVE'
     FOR UPDATE
  `;
  const next = await tx.$queryRaw<RegistryRow[]>`
    SELECT "kid", "publicKeyPem", "privateKeyReference", "status"
      FROM "AccountProductLeaseSigningKey" WHERE "kid" = ${input.newKid}
     FOR UPDATE
  `;
  if (active.length !== 1 || next.length !== 1 ||
      next[0]!.status !== "STAGED" || active[0]!.kid === input.newKid)
    throw new Error("ACCOUNT_PRODUCT_SIGNER_ROTATION_INVALID");
  privatePemFromKeyset(input.keyset, next[0]!);
  await tx.$executeRaw`
    UPDATE "AccountProductLeaseSigningKey"
       SET "status" = 'VERIFY_ONLY', "verifyOnlyAt" = now()
     WHERE "kid" = ${active[0]!.kid} AND "status" = 'ACTIVE'
  `;
  await tx.$executeRaw`
    UPDATE "AccountProductLeaseSigningKey"
       SET "status" = 'ACTIVE', "activatedAt" = now()
     WHERE "kid" = ${input.newKid} AND "status" = 'STAGED'
  `;
  await tx.auditLog.create({ data: {
    actorId: input.adminUserId,
    action: "ACCOUNT_PRODUCT_SIGNER_ROTATED",
    targetType: "AccountProductLeaseSigningKey",
    targetId: input.newKid,
    metadata: { previousKid: active[0]!.kid, newKid: input.newKid },
  } });
}

/**
 * Source-only PREPRODUCTION startup-policy signature over EXACT Agent verifier
 * bytes: domain + serialized JSON payload. Reuses the sole ACTIVE account
 * product JWS signer, never the commercial license signing key. Caller must
 * verify the independent installed Agent attestation + SQL ProductActivation-
 * Policy and consume its nonce in the SAME SERIALIZABLE transaction.
 */
export async function signStandaloneStartupPolicyInTransaction(
  tx: Prisma.TransactionClient,
  payload: string,
  keyset: string | undefined,
): Promise<Readonly<{ kid: string; signature: string }>> {
  if (typeof payload !== "string" || payload.length < 100 || payload.length > 8192)
    throw new Error("STARTUP_POLICY_PAYLOAD_INVALID");
  const rows = await tx.$queryRaw<RegistryRow[]>`
    SELECT "kid", "publicKeyPem", "privateKeyReference", "status"
      FROM "AccountProductLeaseSigningKey"
     WHERE "status" = 'ACTIVE'
     FOR SHARE
  `;
  if (rows.length !== 1 || rows[0]!.status !== "ACTIVE")
    throw new Error("ACCOUNT_PRODUCT_SIGNER_NOT_UNIQUE");
  const row = rows[0]!;
  const pem = privatePemFromKeyset(keyset, row);
  const signature = sign(null, Buffer.from(
    "BKE-STANDALONE-STARTUP-POLICY-V1\\n" + payload, "utf8"),
    createPrivateKey(pem)).toString("base64");
  return Object.freeze({ kid: row.kid, signature });
}
