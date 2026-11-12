import "server-only";

import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";
import { win32 } from "node:path";
import type { Prisma } from "@/platform/persistence/generated/prisma/client";

// This v2 protocol does NOT imply TPM, EK/AIK or manufacturer attestation.
// ES256 is the signature algorithm; public-key enrollment remains two-admin
// and SQL-owned. v1 DPAPI/Ed25519 keeps its separate immutable protocol.
export const startupEs256Contract = Object.freeze({
  candidateSchema: "bke.agent-startup-attestation-enrollment-candidate.v2",
  envelopeSchema: "bke.agent-startup-install-attestation-envelope.v2",
  payloadSchema: "bke.agent-startup-install-attestation.v2",
  signedDomain: "BKE-AGENT-STARTUP-INSTALL-ATTESTATION-V2\n",
  algorithm: "ES256",
});

const CANDIDATE_KEYS = [
  "schema", "kid", "device_id", "algorithm", "public_key_pem", "status",
] as const;
const ENVELOPE_KEYS = ["schema", "kid", "algorithm", "payload", "signature"] as const;
const PAYLOAD_KEYS = [
  "schema", "algorithm", "product_id", "version", "installation_id",
  "image_path", "image_sha256", "allowed_user_sid", "device_id",
  "attestation_id", "issued_at", "expires_at",
] as const;

const KID = /^[A-Za-z0-9._-]{1,128}$/;
const DEVICE = /^[A-Za-z0-9._:-]{16,128}$/;
const SHA = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PRODUCT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;
const SID = /^S-1-(?:5-21-\d+-\d+-\d+-\d+|12-1-\d+-\d+-\d+-\d+)$/;
const SIGNATURE = /^[A-Za-z0-9+/]{86}==$/;
const MAX_AGE = 120_000;
const maxText = 8192;

type TrustRow = Readonly<{
  kid: string; deviceId: string; publicKeyPem: string;
  algorithm: string; status: string;
}>;

function canonical(raw: string, keys: readonly string[], max = maxText) {
  if (typeof raw !== "string" || raw.length < 5 || raw.length > max ||
      raw.includes("PRIVATE KEY")) throw new Error("STARTUP_ES256_NONCANONICAL");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("STARTUP_ES256_NONCANONICAL"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("STARTUP_ES256_NONCANONICAL");
  const obj = parsed as Record<string, unknown>;
  if (Object.keys(obj).length !== keys.length ||
      Object.keys(obj).some((key, i) => key !== keys[i]) ||
      JSON.stringify(obj) !== raw)
    throw new Error("STARTUP_ES256_NONCANONICAL");
  return obj;
}

function field(row: Record<string, unknown>, key: string, max = 2048) {
  const v = row[key];
  if (typeof v !== "string" || !v.length || v.length > max ||
      (key !== "public_key_pem" && v.trim() !== v))
    throw new Error("STARTUP_ES256_FIELD_INVALID");
  return v;
}

export function canonicalEs256PublicKey(pem: string): Readonly<{
  key: KeyObject; fingerprintSha256: string;
}> {
  if (typeof pem !== "string" || pem.length > 2048 ||
      !pem.startsWith("-----BEGIN PUBLIC KEY-----\n"))
    throw new Error("STARTUP_ES256_PUBLIC_KEY_INVALID");
  try {
    const key = createPublicKey(pem);
    if (key.asymmetricKeyType !== "ec" ||
        key.asymmetricKeyDetails?.namedCurve !== "prime256v1" ||
        key.export({ type: "spki", format: "pem" }).toString() !== pem)
      throw new Error("KEY_ALGORITHM_MISMATCH");
    const der = key.export({ type: "spki", format: "der" });
    return Object.freeze({
      key, fingerprintSha256: createHash("sha256").update(der).digest("hex"),
    });
  } catch {
    throw new Error("STARTUP_ES256_PUBLIC_KEY_INVALID");
  }
}

export function parseEs256EnrollmentCandidate(raw: string) {
  const record = canonical(raw, CANDIDATE_KEYS);
  if (field(record, "schema", 128) !== startupEs256Contract.candidateSchema ||
      field(record, "algorithm", 16) !== "ES256" ||
      field(record, "status", 16) !== "STAGED")
    throw new Error("STARTUP_ES256_CANDIDATE_INVALID");
  const kid = field(record, "kid", 128);
  const deviceId = field(record, "device_id", 128);
  if (!KID.test(kid) || !DEVICE.test(deviceId))
    throw new Error("STARTUP_ES256_CANDIDATE_INVALID");
  const publicKeyPem = field(record, "public_key_pem", 2048);
  const fingerprintSha256 = canonicalEs256PublicKey(publicKeyPem).fingerprintSha256;
  return Object.freeze({ kid, deviceId, publicKeyPem, fingerprintSha256 });
}

function absoluteInstalledImage(path: string) {
  return win32.isAbsolute(path) && win32.normalize(path) === path &&
    !path.includes("/") && !path.includes("\u0000") && path.length <= 2048 &&
    /^[A-Z]:\\Program Files\\BKE Digital Solutions\\[^\\]+\\.+\.exe$/i.test(path) &&
    !path.split("\\").some(v => v === "." || v === "..");
}
function canonicalTime(time: string) {
  const ms = Date.parse(time);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== time)
    throw new Error("STARTUP_ES256_TIME_INVALID");
  return ms;
}

export function verifyEs256Possession(
  rawEnvelope: string,
  trusted: Readonly<{ kid: string; deviceId: string; publicKeyPem: string }>,
  now = new Date(),
) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
    throw new Error("STARTUP_ES256_CLOCK_INVALID");
  const e = canonical(rawEnvelope, ENVELOPE_KEYS, 16_384);
  if (field(e, "schema", 128) !== startupEs256Contract.envelopeSchema ||
      field(e, "algorithm", 16) !== "ES256" ||
      field(e, "kid", 128) !== trusted.kid)
    throw new Error("STARTUP_ES256_PROTOCOL_INVALID");
  const payload = field(e, "payload", maxText);
  const p = canonical(payload, PAYLOAD_KEYS);
  if (field(p, "schema", 128) !== startupEs256Contract.payloadSchema ||
      field(p, "algorithm", 16) !== "ES256")
    throw new Error("STARTUP_ES256_PROTOCOL_INVALID");
  const productId = field(p, "product_id", 128);
  const version = field(p, "version", 128);
  const installationId = field(p, "installation_id", 64);
  const imagePath = field(p, "image_path");
  const imageSha256 = field(p, "image_sha256", 64);
  const allowedUserSid = field(p, "allowed_user_sid", 256);
  const deviceId = field(p, "device_id", 128);
  const attestationId = field(p, "attestation_id", 64);
  const issued = canonicalTime(field(p, "issued_at", 64));
  const expires = canonicalTime(field(p, "expires_at", 64));
  if (!PRODUCT.test(productId) || !VERSION.test(version) ||
      !UUID.test(installationId) || !UUID.test(attestationId) ||
      !SHA.test(imageSha256) || !SID.test(allowedUserSid) ||
      deviceId !== trusted.deviceId || !DEVICE.test(deviceId) ||
      !absoluteInstalledImage(imagePath))
    throw new Error("STARTUP_ES256_SCOPE_INVALID");
  if (issued > now.getTime() || expires <= now.getTime() ||
      expires <= issued || expires - issued > MAX_AGE)
    throw new Error("STARTUP_ES256_EXPIRED");

  const encoded = field(e, "signature", 128);
  if (!SIGNATURE.test(encoded)) throw new Error("STARTUP_ES256_SIGNATURE_INVALID");
  const signature = Buffer.from(encoded, "base64");
  if (signature.length !== 64 || signature.toString("base64") !== encoded ||
      !verify("sha256",
        Buffer.from(startupEs256Contract.signedDomain + payload, "utf8"),
        { key: canonicalEs256PublicKey(trusted.publicKeyPem).key, dsaEncoding: "ieee-p1363" },
        signature))
    throw new Error("STARTUP_ES256_SIGNATURE_INVALID");

  return Object.freeze({
    attestationId, signerKid: trusted.kid, deviceId,
    productId, version, installationId, imagePath, imageSha256,
    allowedUserSid, attestationSha256:
      createHash("sha256").update(rawEnvelope).digest("hex"),
    algorithm: "ES256" as const,
    hardwareAttested: false as const,
  });
}

/** SQL ACTIVE-only ES256 v2 trust. Does not grant a TPM assurance tier. */
export async function verifyStartupEs256AttestationInTransaction(
  tx: Prisma.TransactionClient, raw: string, now = new Date(),
) {
  const envelope = canonical(raw, ENVELOPE_KEYS, 16_384);
  if (field(envelope, "schema", 128) !== startupEs256Contract.envelopeSchema ||
      field(envelope, "algorithm", 16) !== "ES256")
    throw new Error("STARTUP_ES256_PROTOCOL_INVALID");
  const kid = field(envelope, "kid", 128);
  if (!KID.test(kid)) throw new Error("STARTUP_ES256_KID_INVALID");
  const payload = canonical(field(envelope, "payload", maxText), PAYLOAD_KEYS);
  const deviceId = field(payload, "device_id", 128);
  if (!DEVICE.test(deviceId)) throw new Error("STARTUP_ES256_SCOPE_INVALID");
  const rows = await tx.$queryRaw<TrustRow[]>`
    SELECT "kid","deviceId","publicKeyPem","algorithm","status"
      FROM "AgentStartupAttestationSigningKey"
     WHERE "kid"=${kid} AND "deviceId"=${deviceId}
       AND "algorithm"='ES256' AND "status"='ACTIVE'
     FOR SHARE
  `;
  if (rows.length !== 1 || rows[0]!.kid !== kid ||
      rows[0]!.deviceId !== deviceId || rows[0]!.algorithm !== "ES256" ||
      rows[0]!.status !== "ACTIVE")
    throw new Error("STARTUP_ES256_UNTRUSTED_AGENT");
  return verifyEs256Possession(raw, rows[0]!, now);
}
