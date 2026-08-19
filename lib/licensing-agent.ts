import "server-only";
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { env } from "@/lib/env";

export type LeasePayload = { license_id: string; lease_id: string; generation: number; server_revision: number; product_id: string; installation_id: string; device_id: string; version: string; issuer: string; issued_at: string; not_before: string; expires_at: string; key_id: string; algorithm: "Ed25519"; revoked: boolean; superseded_by: string | null };
const testKeys = !env.LICENSE_SIGNING_PRIVATE_KEY && env.NODE_ENV !== "production" ? generateKeyPairSync("ed25519") : null;
function key(value: string | undefined, type: "private" | "public") { if (!value && testKeys) return type === "private" ? testKeys.privateKey : testKeys.publicKey; if (!value) throw new Error("LEASE_SIGNING_NOT_CONFIGURED"); const raw = value.includes("BEGIN") ? value : Buffer.from(value, "base64").toString("utf8"); return type === "private" ? createPrivateKey(raw) : createPublicKey(raw); }
function canonical(payload: LeasePayload) { return Buffer.from(JSON.stringify(payload, Object.keys(payload).sort()), "utf8"); }
export function issueSignedLease(payload: LeasePayload, privateKeyOverride?: string) {
  if (env.NODE_ENV === "production" && !privateKeyOverride && (!env.LICENSE_SIGNING_PRIVATE_KEY || !env.LICENSE_SIGNING_PUBLIC_KEY)) throw new Error("LEASE_SIGNING_NOT_CONFIGURED");
  const serialized = canonical(payload).toString("utf8");
  const privateKey = key(privateKeyOverride ?? env.LICENSE_SIGNING_PRIVATE_KEY, "private");
  const signature = sign(null, Buffer.from(serialized), privateKey).toString("base64");
  // Never return an envelope that cannot be verified by the corresponding key.
  const publicKey = createPublicKey(privateKey);
  if (!verify(null, Buffer.from(serialized), publicKey, Buffer.from(signature, "base64"))) throw new Error("LEASE_SIGNING_SELF_VERIFICATION_FAILED");
  return { payload: serialized, signature, key_id: payload.key_id, algorithm: "Ed25519" as const };
}
export function verifySignedLease(lease: ReturnType<typeof issueSignedLease>, publicKeyOverride?: string) { return Boolean(lease.algorithm === "Ed25519" && verify(null, Buffer.from(lease.payload), key(publicKeyOverride ?? env.LICENSE_SIGNING_PUBLIC_KEY, "public"), Buffer.from(lease.signature, "base64"))); }
export function publicLeaseKey() { if (env.NODE_ENV === "production" && !env.LICENSE_SIGNING_PUBLIC_KEY) throw new Error("LEASE_SIGNING_NOT_CONFIGURED"); const configured = env.LICENSE_SIGNING_PUBLIC_KEY; const publicKey = configured ? (configured.includes("BEGIN") ? configured : Buffer.from(configured, "base64").toString("utf8")) : testKeys?.publicKey.export({ format: "pem", type: "spki" }).toString(); return { key_id: env.LICENSE_SIGNING_KEY_ID, algorithm: "Ed25519" as const, public_key: publicKey }; }
