import {
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import { valid } from "semver";

export const AGENT_ACCOUNT_REPAIR_POLICY_SCHEMA = "bke.repair-policy.v1" as const;
export const AGENT_ACCOUNT_REPAIR_SOURCE_AUTHORITY = "GITHUB_RELEASES" as const;
export const AGENT_ACCOUNT_REPAIR_CHANNEL = "stable" as const;
export const AGENT_ACCOUNT_REPAIR_POLICY_TTL_SECONDS = 300;

export type AgentAccountRepairPlatform = "windows" | "macos" | "linux";
export type AgentAccountRepairArchitecture = "x64" | "arm64" | "x86";

export type SignedAgentAccountRepairPolicy = Readonly<{
  schema: typeof AGENT_ACCOUNT_REPAIR_POLICY_SCHEMA;
  product_id: string;
  repair_version: string;
  channel: typeof AGENT_ACCOUNT_REPAIR_CHANNEL;
  platform: AgentAccountRepairPlatform;
  architecture: AgentAccountRepairArchitecture;
  source_authority: typeof AGENT_ACCOUNT_REPAIR_SOURCE_AUTHORITY;
  repository: string;
  tag: string;
  issued_at: string;
  expires_at: string;
  signing_key_id: string;
  algorithm: "Ed25519";
  signature: string;
}>;

type UnsignedAgentAccountRepairPolicy =
  Omit<SignedAgentAccountRepairPolicy, "signature">;

export type AgentAccountRepairPolicyInput = Readonly<{
  productId: string;
  repairVersion: string;
  platform: AgentAccountRepairPlatform;
  architecture: AgentAccountRepairArchitecture;
  repository: string;
}>;

export type AgentAccountRepairSigningMaterial = Readonly<{
  keyId: string;
  algorithm: string;
  publicKey: string;
  privateKey: string;
}>;

const SAFE_PRODUCT_ID = /^[a-z0-9-]+$/;
const SAFE_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SAFE_KEY_ID = /^[A-Za-z0-9._-]{1,128}$/;

function keyMaterial(value: string): string | Buffer {
  return value.includes("BEGIN")
    ? value
    : Buffer.from(value, "base64");
}

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, ordered(nested)]),
    );
  }
  return value;
}

export function canonicalAgentAccountRepairPolicy(
  policy: UnsignedAgentAccountRepairPolicy,
): Buffer {
  return Buffer.from(JSON.stringify(ordered(policy)), "utf8");
}

function ed25519PrivateKey(value: string): KeyObject {
  const key = createPrivateKey(keyMaterial(value));
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("REPAIR_POLICY_SIGNING_KEY_INVALID");
  }
  return key;
}

function ed25519PublicKey(value: string): KeyObject {
  const key = createPublicKey(keyMaterial(value));
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("REPAIR_POLICY_PUBLIC_KEY_INVALID");
  }
  return key;
}

export function signAgentAccountRepairPolicy(
  input: AgentAccountRepairPolicyInput,
  key: AgentAccountRepairSigningMaterial,
  issuedAt = new Date(),
): SignedAgentAccountRepairPolicy {
  if (!SAFE_PRODUCT_ID.test(input.productId)) {
    throw new Error("REPAIR_POLICY_PRODUCT_ID_INVALID");
  }
  if (!valid(input.repairVersion)) {
    throw new Error("REPAIR_POLICY_VERSION_INVALID");
  }
  if (!SAFE_REPOSITORY.test(input.repository)) {
    throw new Error("REPAIR_POLICY_REPOSITORY_INVALID");
  }
  if (!SAFE_KEY_ID.test(key.keyId) || key.algorithm !== "Ed25519") {
    throw new Error("REPAIR_POLICY_SIGNING_KEY_INVALID");
  }

  const expiresAt = new Date(
    issuedAt.getTime() + AGENT_ACCOUNT_REPAIR_POLICY_TTL_SECONDS * 1000,
  );
  const unsigned: UnsignedAgentAccountRepairPolicy = Object.freeze({
    schema: AGENT_ACCOUNT_REPAIR_POLICY_SCHEMA,
    product_id: input.productId,
    repair_version: input.repairVersion,
    channel: AGENT_ACCOUNT_REPAIR_CHANNEL,
    platform: input.platform,
    architecture: input.architecture,
    source_authority: AGENT_ACCOUNT_REPAIR_SOURCE_AUTHORITY,
    repository: input.repository,
    tag: `v${input.repairVersion}`,
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    signing_key_id: key.keyId,
    algorithm: "Ed25519" as const,
  });

  const privateKey = ed25519PrivateKey(key.privateKey);
  const publicKey = ed25519PublicKey(key.publicKey);
  const canonical = canonicalAgentAccountRepairPolicy(unsigned);
  const signature = sign(null, canonical, privateKey);
  if (!verify(null, canonical, publicKey, signature)) {
    throw new Error("REPAIR_POLICY_SIGNING_SELF_VERIFY_FAILED");
  }

  return Object.freeze({
    ...unsigned,
    signature: signature.toString("base64"),
  });
}
