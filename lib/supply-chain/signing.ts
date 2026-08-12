import "server-only";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { env } from "@/lib/env";
import { resolveTrustedSupplyChainKey } from "@/lib/supply-chain/keyring";
import { buildReleaseManifest, canonicalizeManifest, manifestHash, type SignedReleaseManifest } from "@/lib/supply-chain/manifest";

function keyMaterial(raw: string): string { return raw.includes("BEGIN") ? raw : Buffer.from(raw, "base64").toString("utf8"); }
function publicKey(keyId: string) { const resolved = resolveTrustedSupplyChainKey(env.SUPPLY_CHAIN_TRUSTED_KEYS, env.SUPPLY_CHAIN_SIGNING_KEY_ID, env.SUPPLY_CHAIN_SIGNING_PUBLIC_KEY, keyId); return { keyId: resolved.keyId, key: createPublicKey(keyMaterial(resolved.key)) }; }

export function signReleaseManifest(input: Omit<SignedReleaseManifest, "schema" | "signingKeyId">): { manifest: SignedReleaseManifest; canonicalPayload: string; payloadHash: string; signature: string; keyId: string; algorithm: "Ed25519" } {
  if (!env.SUPPLY_CHAIN_SIGNING_PRIVATE_KEY) throw new Error("SUPPLY_CHAIN_SIGNING_NOT_CONFIGURED");
  const keyId = env.SUPPLY_CHAIN_SIGNING_KEY_ID;
  const manifest = buildReleaseManifest({ ...input, signingKeyId: keyId });
  const canonicalPayload = canonicalizeManifest(manifest);
  const signature = sign(null, Buffer.from(canonicalPayload), createPrivateKey(keyMaterial(env.SUPPLY_CHAIN_SIGNING_PRIVATE_KEY))).toString("base64");
  const trusted = publicKey(keyId);
  if (!verify(null, Buffer.from(canonicalPayload), trusted.key, Buffer.from(signature, "base64"))) throw new Error("SUPPLY_CHAIN_SIGNATURE_SELF_VERIFY_FAILED");
  return { manifest, canonicalPayload, payloadHash: manifestHash(canonicalPayload), signature, keyId, algorithm: "Ed25519" };
}
