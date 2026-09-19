import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TOKEN_BUNDLE_VERSION = "v1";

export interface AgentAccountTokenBundle {
  readonly sessionId: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accessExpiresAt: string;
  readonly refreshExpiresAt: string;
  readonly userId: string;
  readonly email: string;
  readonly accountId: string;
  readonly accountType: "INDIVIDUAL" | "ORGANIZATION";
  readonly accountDisplayName: string;
}

function requiredSecret(secret: string, code: string): string {
  const normalized = secret.trim();
  if (normalized.length < 32) throw new Error(code);
  return normalized;
}

function hmac(value: string, pepper: string, domain: string): string {
  return createHmac("sha256", requiredSecret(pepper, "AGENT_ACCOUNT_SESSION_PEPPER_REQUIRED"))
    .update(domain, "utf8")
    .update("\0", "utf8")
    .update(value, "utf8")
    .digest("hex");
}

export function generateAgentDeviceCode(): string {
  return randomBytes(32).toString("base64url");
}

export function generateAgentSessionToken(): string {
  return randomBytes(48).toString("base64url");
}

export function generateAgentUserCode(): string {
  let body = "";
  const bytes = randomBytes(8);
  for (let index = 0; index < bytes.length; index += 1) {
    body += USER_CODE_ALPHABET[bytes[index]! % USER_CODE_ALPHABET.length];
  }
  return `BKE-${body.slice(0, 4)}-${body.slice(4)}`;
}

export function normalizeAgentUserCode(value: string): string {
  return value.trim().toUpperCase();
}

export function hashAgentDeviceCode(value: string, pepper: string): string {
  return hmac(value.trim(), pepper, "bke-agent-device-code-v1");
}

export function hashAgentUserCode(value: string, pepper: string): string {
  return hmac(normalizeAgentUserCode(value), pepper, "bke-agent-user-code-v1");
}

export function hashAgentAccessToken(value: string, pepper: string): string {
  return hmac(value.trim(), pepper, "bke-agent-access-token-v1");
}

export function hashAgentRefreshToken(value: string, pepper: string): string {
  return hmac(value.trim(), pepper, "bke-agent-refresh-token-v1");
}

function bundleKey(secret: string): Buffer {
  return createHash("sha256")
    .update("bke-agent-account-session-handoff-v1\0", "utf8")
    .update(requiredSecret(secret, "AGENT_ACCOUNT_SESSION_ENCRYPTION_KEY_REQUIRED"), "utf8")
    .digest();
}

export function encryptAgentTokenBundle(
  bundle: AgentAccountTokenBundle,
  secret: string,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", bundleKey(secret), iv);
  const plaintext = Buffer.from(JSON.stringify(bundle), "utf8");
  try {
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return [
      TOKEN_BUNDLE_VERSION,
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  } finally {
    plaintext.fill(0);
  }
}

export function decryptAgentTokenBundle(
  value: string,
  secret: string,
): AgentAccountTokenBundle {
  const [version, ivText, tagText, ciphertextText, extra] = value.split(".");
  if (
    version !== TOKEN_BUNDLE_VERSION ||
    !ivText ||
    !tagText ||
    !ciphertextText ||
    extra !== undefined
  ) {
    throw new Error("INVALID_AGENT_TOKEN_BUNDLE");
  }

  const iv = Buffer.from(ivText, "base64url");
  const tag = Buffer.from(tagText, "base64url");
  const ciphertext = Buffer.from(ciphertextText, "base64url");
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
    throw new Error("INVALID_AGENT_TOKEN_BUNDLE");
  }

  const decipher = createDecipheriv("aes-256-gcm", bundleKey(secret), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  try {
    const parsed = JSON.parse(plaintext.toString("utf8")) as Partial<AgentAccountTokenBundle>;
    if (
      typeof parsed.sessionId !== "string" ||
      typeof parsed.accessToken !== "string" ||
      typeof parsed.refreshToken !== "string" ||
      typeof parsed.accessExpiresAt !== "string" ||
      typeof parsed.refreshExpiresAt !== "string" ||
      typeof parsed.userId !== "string" ||
      typeof parsed.email !== "string" ||
      typeof parsed.accountId !== "string" ||
      (parsed.accountType !== "INDIVIDUAL" && parsed.accountType !== "ORGANIZATION") ||
      typeof parsed.accountDisplayName !== "string"
    ) {
      throw new Error("INVALID_AGENT_TOKEN_BUNDLE");
    }
    return Object.freeze(parsed as AgentAccountTokenBundle);
  } finally {
    plaintext.fill(0);
  }
}
