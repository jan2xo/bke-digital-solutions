import {
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import { valid, gt } from "semver";

export const AGENT_ACCOUNT_UPDATE_POLICY_SCHEMA = "bke.update-policy.v2" as const;
export const AGENT_ACCOUNT_UPDATE_SOURCE_AUTHORITY = "GITHUB_RELEASES" as const;
export const AGENT_ACCOUNT_UPDATE_CHANNEL = "stable" as const;
export const AGENT_ACCOUNT_UPDATE_POLICY_TTL_SECONDS = 120;

export type AgentAccountUpdatePlatform = "windows" | "macos" | "linux";
export type AgentAccountUpdateArchitecture = "x64" | "arm64" | "x86";

export type SignedAgentAccountUpdatePolicy = Readonly<{
  schema: typeof AGENT_ACCOUNT_UPDATE_POLICY_SCHEMA;
  product_id: string;
  current_version: string;
  target_version: string;
  channel: typeof AGENT_ACCOUNT_UPDATE_CHANNEL;
  platform: AgentAccountUpdatePlatform;
  architecture: AgentAccountUpdateArchitecture;
  source_authority: typeof AGENT_ACCOUNT_UPDATE_SOURCE_AUTHORITY;
  repository: string;
  tag: string;
  issued_at: string;
  expires_at: string;
  signing_key_id: string;
  algorithm: "Ed25519";
  signature: string;
}>;

type UnsignedAgentAccountUpdatePolicy =
  Omit<SignedAgentAccountUpdatePolicy, "signature">;

export type AgentAccountUpdatePolicyInput = Readonly<{
  productId: string;
  currentVersion: string;
  targetVersion: string;
  platform: AgentAccountUpdatePlatform;
  architecture: AgentAccountUpdateArchitecture;
  repository: string;
}>;

export type AgentAccountUpdateSigningMaterial = Readonly<{
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

export function canonicalAgentAccountUpdatePolicy(
  policy: UnsignedAgentAccountUpdatePolicy,
): Buffer {
  return Buffer.from(JSON.stringify(ordered(policy)), "utf8");
}

function ed25519PrivateKey(value: string): KeyObject {
  const key = createPrivateKey(keyMaterial(value));
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("UPDATE_POLICY_SIGNING_KEY_INVALID");
  }
  return key;
}

function ed25519PublicKey(value: string): KeyObject {
  const key = createPublicKey(keyMaterial(value));
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("UPDATE_POLICY_PUBLIC_KEY_INVALID");
  }
  return key;
}

export function signAgentAccountUpdatePolicy(
  input: AgentAccountUpdatePolicyInput,
  key: AgentAccountUpdateSigningMaterial,
  issuedAt = new Date(),
): SignedAgentAccountUpdatePolicy {
  if (!SAFE_PRODUCT_ID.test(input.productId)) {
    throw new Error("UPDATE_POLICY_PRODUCT_ID_INVALID");
  }
  if (!valid(input.currentVersion) || !valid(input.targetVersion)) {
    throw new Error("UPDATE_POLICY_VERSION_INVALID");
  }
  if (!gt(input.targetVersion, input.currentVersion)) {
    throw new Error("UPDATE_POLICY_TARGET_NOT_NEWER");
  }
  if (!SAFE_REPOSITORY.test(input.repository)) {
    throw new Error("UPDATE_POLICY_REPOSITORY_INVALID");
  }
  if (!SAFE_KEY_ID.test(key.keyId) || key.algorithm !== "Ed25519") {
    throw new Error("UPDATE_POLICY_SIGNING_KEY_INVALID");
  }

  const expiresAt = new Date(
    issuedAt.getTime() + AGENT_ACCOUNT_UPDATE_POLICY_TTL_SECONDS * 1000,
  );
  const unsigned: UnsignedAgentAccountUpdatePolicy = Object.freeze({
    schema: AGENT_ACCOUNT_UPDATE_POLICY_SCHEMA,
    product_id: input.productId,
    current_version: input.currentVersion,
    target_version: input.targetVersion,
    channel: AGENT_ACCOUNT_UPDATE_CHANNEL,
    platform: input.platform,
    architecture: input.architecture,
    source_authority: AGENT_ACCOUNT_UPDATE_SOURCE_AUTHORITY,
    repository: input.repository,
    tag: `v${input.targetVersion}`,
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    signing_key_id: key.keyId,
    algorithm: "Ed25519" as const,
  });

  const privateKey = ed25519PrivateKey(key.privateKey);
  const publicKey = ed25519PublicKey(key.publicKey);
  const canonical = canonicalAgentAccountUpdatePolicy(unsigned);
  const signature = sign(null, canonical, privateKey);
  if (!verify(null, canonical, publicKey, signature)) {
    throw new Error("UPDATE_POLICY_SIGNING_SELF_VERIFY_FAILED");
  }

  return Object.freeze({
    ...unsigned,
    signature: signature.toString("base64"),
  });
}
