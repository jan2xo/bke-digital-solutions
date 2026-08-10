import "server-only";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

export function resolveCommercialPrivateKey(reference: string) {
  const prefix = "env:";
  if (!reference.startsWith(prefix)) throw new Error("SIGNING_KEY_REFERENCE_UNSUPPORTED");
  const value = process.env[reference.slice(prefix.length)];
  if (!value) throw new Error("SIGNING_KEY_UNRESOLVED");
  return value;
}

export async function ensureCommercialSigningKey() {
  const existing = await db.commercialSigningKey.findFirst({ where: { status: "ACTIVE" } });
  if (existing) return existing;
  if (!env.LICENSE_SIGNING_PRIVATE_KEY || !env.LICENSE_SIGNING_PUBLIC_KEY) throw new Error("LEASE_SIGNING_NOT_CONFIGURED");
  return db.commercialSigningKey.create({ data: { keyId: env.LICENSE_SIGNING_KEY_ID, publicKey: env.LICENSE_SIGNING_PUBLIC_KEY, privateKeyReference: "env:LICENSE_SIGNING_PRIVATE_KEY" } });
}

export async function activeCommercialSigningKey() {
  const keys = await db.commercialSigningKey.findMany({ where: { status: "ACTIVE" } });
  if (keys.length !== 1) throw new Error(keys.length === 0 ? "NO_ACTIVE_SIGNING_KEY" : "MULTIPLE_ACTIVE_SIGNING_KEYS");
  const key = keys[0]!;
  return { ...key, privateKey: resolveCommercialPrivateKey(key.privateKeyReference) };
}
