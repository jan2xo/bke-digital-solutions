import "server-only";

import { createHash, createPublicKey, verify } from "node:crypto";
import { win32 } from "node:path";
import type { Prisma } from "@/platform/persistence/generated/prisma/client";

const ENVELOPE_SCHEMA = "bke.agent-startup-install-attestation-envelope.v1";
const PAYLOAD_SCHEMA = "bke.agent-startup-install-attestation.v1";
const SIGNED_DOMAIN = "BKE-AGENT-STARTUP-INSTALL-ATTESTATION-V1\n";
const KID = /^[A-Za-z0-9._-]{1,128}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX = /^[0-9a-f]{64}$/;
const DEVICE_ID = /^[A-Za-z0-9._:-]{16,128}$/;
const USER_SID = /^S-1-(?:5-21-\d+-\d+-\d+-\d+|12-1-\d+-\d+-\d+-\d+)$/;
const SIGNATURE = /^[A-Za-z0-9+/]{86}==$/;
const MAX_ATTESTATION_AGE_MS = 120_000;
const verifiedBrand = Symbol("bke.ds.installed-agent.attestation.internal");

type AttestationTrustRow = Readonly<{
  kid: string;
  deviceId: string;
  publicKeyPem: string;
  status: "STAGED" | "ACTIVE" | "REVOKED";
}>;

export type VerifiedStandaloneStartupInstallAttestation = Readonly<{
  [verifiedBrand]: true;
  attestationId: string;
  signerKid: string;
  deviceId: string;
  productId: string;
  version: string;
  installationId: string;
  imagePath: string;
  imageSha256: string;
  allowedUserSid: string;
  attestationSha256: string;
}>;

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== keys.length ||
      Object.keys(value).some(key => !keys.includes(key)))
    throw new Error("STARTUP_ATTESTATION_SHAPE_INVALID");
  return value as Record<string, unknown>;
}

function canonicalObject(raw: string, keys: readonly string[]): Record<string, unknown> {
  if (!raw || raw.length > 8192) throw new Error("STARTUP_ATTESTATION_SHAPE_INVALID");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error("STARTUP_ATTESTATION_SHAPE_INVALID"); }
  const value = exactObject(parsed, keys);
  if (JSON.stringify(value) !== raw)
    throw new Error("STARTUP_ATTESTATION_NONCANONICAL");
  return value;
}

function required(record: Record<string, unknown>, name: string, max = 2048): string {
  const value = record[name];
  if (typeof value !== "string" || !value || value.length > max ||
      value.trim() !== value)
    throw new Error("STARTUP_ATTESTATION_SCOPE_INVALID");
  return value;
}

function canonicalTime(value: string): number {
  const millis = Date.parse(value);
  if (!Number.isFinite(millis) || new Date(millis).toISOString() !== value)
    throw new Error("STARTUP_ATTESTATION_TIME_INVALID");
  return millis;
}

function canonicalImagePath(image: string): boolean {
  // No UNC, relative, device, drive substitution or dot-dot. The installed
  // Agent independently observes actual image path/hash from Windows kernel.
  if (!win32.isAbsolute(image) || win32.normalize(image) !== image ||
      image.includes("/") || image.includes("\u0000") || image.length > 2048)
    return false;
  return /^[A-Z]:\\Program Files\\BKE Digital Solutions\\[^\\]+\\.+\.exe$/i.test(image) &&
    !image.split("\\").some(part => part === "." || part === "..");
}

function canonicalEd25519Key(pem: string) {
  if (pem.length > 2048 || !pem.startsWith("-----BEGIN PUBLIC KEY-----\n"))
    throw new Error("STARTUP_ATTESTATION_TRUST_INVALID");
  try {
    const key = createPublicKey(pem);
    if (key.asymmetricKeyType !== "ed25519" ||
        key.export({ type: "spki", format: "pem" }).toString() !== pem)
      throw new Error("BAD_KEY");
    return key;
  } catch {
    throw new Error("STARTUP_ATTESTATION_TRUST_INVALID");
  }
}

/** Public-only attestation key MUST be independently enrolled by privileged
 * Agent installer. Caller-supplied keys/certificates are never trust anchors.
 * Key-only products do not require a Google/account session. */
export async function verifyStandaloneStartupInstallAttestationInTransaction(
  tx: Prisma.TransactionClient,
  rawEnvelope: string,
  now = new Date(),
): Promise<VerifiedStandaloneStartupInstallAttestation> {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()) ||
      typeof rawEnvelope !== "string" || rawEnvelope.length > 16_384)
    throw new Error("STARTUP_ATTESTATION_UNAVAILABLE");

  const envelope = canonicalObject(rawEnvelope, [
    "schema", "kid", "payload", "signature",
  ]);
  if (required(envelope, "schema", 128) !== ENVELOPE_SCHEMA)
    throw new Error("STARTUP_ATTESTATION_PROTOCOL_INVALID");
  const kid = required(envelope, "kid", 128);
  const payload = required(envelope, "payload", 8192);
  const signature = required(envelope, "signature", 128);
  if (!KID.test(kid) || !SIGNATURE.test(signature))
    throw new Error("STARTUP_ATTESTATION_SIGNATURE_INVALID");
  const fields = canonicalObject(payload, [
    "schema", "product_id", "version", "installation_id", "image_path",
    "image_sha256", "allowed_user_sid", "device_id", "attestation_id",
    "issued_at", "expires_at",
  ]);
  const productId = required(fields, "product_id", 128);
  const version = required(fields, "version", 128);
  const installationId = required(fields, "installation_id", 64);
  const imagePath = required(fields, "image_path");
  const imageSha256 = required(fields, "image_sha256", 64);
  const allowedUserSid = required(fields, "allowed_user_sid", 256);
  const deviceId = required(fields, "device_id", 128);
  const attestationId = required(fields, "attestation_id", 64);
  const issued = canonicalTime(required(fields, "issued_at", 64));
  const expires = canonicalTime(required(fields, "expires_at", 64));

  if (required(fields, "schema", 128) !== PAYLOAD_SCHEMA ||
      !SLUG.test(productId) || !VERSION.test(version) ||
      !UUID.test(installationId) || !UUID.test(attestationId))
    throw new Error("STARTUP_ATTESTATION_PRODUCT_SCOPE_INVALID");
  if (!HEX.test(imageSha256) || !DEVICE_ID.test(deviceId) ||
      !USER_SID.test(allowedUserSid))
    throw new Error("STARTUP_ATTESTATION_DEVICE_SCOPE_INVALID");
  if (!canonicalImagePath(imagePath))
    throw new Error("STARTUP_ATTESTATION_IMAGE_SCOPE_INVALID");
  if (issued > now.getTime() || expires <= now.getTime() ||
      expires <= issued || expires - issued > MAX_ATTESTATION_AGE_MS)
    throw new Error("STARTUP_ATTESTATION_TIME_SCOPE_INVALID");

  const rows = await tx.$queryRaw<AttestationTrustRow[]>`
    SELECT "kid", "deviceId", "publicKeyPem", "status"
      FROM "AgentStartupAttestationSigningKey"
     WHERE "kid" = ${kid} AND "deviceId" = ${deviceId}
       AND "status" = 'ACTIVE'
     FOR SHARE
  `;
  if (rows.length !== 1 || rows[0]!.kid !== kid ||
      rows[0]!.status !== "ACTIVE" || rows[0]!.deviceId !== deviceId)
    throw new Error("STARTUP_ATTESTATION_UNTRUSTED_AGENT");

  const key = canonicalEd25519Key(rows[0]!.publicKeyPem);
  const signatureBytes = Buffer.from(signature, "base64");
  if (signatureBytes.length !== 64 ||
      signatureBytes.toString("base64") !== signature ||
      !verify(null, Buffer.from(SIGNED_DOMAIN + payload, "utf8"),
        key, signatureBytes))
    throw new Error("STARTUP_ATTESTATION_SIGNATURE_INVALID");

  return Object.freeze({
    [verifiedBrand]: true as const,
    attestationId, signerKid: kid, deviceId,
    productId, version, installationId, imagePath, imageSha256,
    allowedUserSid,
    attestationSha256: createHash("sha256").update(rawEnvelope).digest("hex"),
  });
}

export const standaloneStartupAttestationContract = Object.freeze({
  envelopeSchema: ENVELOPE_SCHEMA,
  payloadSchema: PAYLOAD_SCHEMA,
  signedDomain: SIGNED_DOMAIN,
});
