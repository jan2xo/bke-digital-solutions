import "server-only";

export interface WebHostEnvironment {
  readonly nodeEnv: "development" | "test" | "production";
  readonly appUrl: string;
  readonly trustedOrigins: readonly string[];
  readonly trustProxyHops: number;
  readonly redisUrl?: string;
  readonly redisKeyPrefix: string;
  readonly upstashRedisRestUrl?: string;
  readonly upstashRedisRestToken?: string;
}

export interface CronEnvironment {
  readonly cronSecret: string;
}

export interface LegalPresentationEnvironment {
  readonly appUrl: string;
  readonly supportEmail: string;
  readonly businessAddress: string;
}

function required(name: string, minLength = 1): string {
  const value = process.env[name]?.trim();
  if (!value || value.length < minLength) throw new Error(`Missing web host environment: ${name}`);
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function parseNodeEnv(): WebHostEnvironment["nodeEnv"] {
  const value = process.env.NODE_ENV ?? "development";
  if (value !== "development" && value !== "test" && value !== "production") {
    throw new Error("Invalid web host environment: NODE_ENV");
  }
  return value;
}

function parseTrustProxyHops(): number {
  const raw = process.env.TRUST_PROXY_HOPS?.trim() || "1";
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 5) {
    throw new Error("Invalid web host environment: TRUST_PROXY_HOPS");
  }
  return value;
}

function canonicalOrigin(value: string, name: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid web host environment: ${name}`);
  }
  return parsed.origin;
}

export function getWebHostEnvironment(): WebHostEnvironment {
  const appUrl = required("APP_URL");
  canonicalOrigin(appUrl, "APP_URL");
  const trustedOrigins = (optional("TRUSTED_ORIGINS") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => canonicalOrigin(value, "TRUSTED_ORIGINS"));

  const upstashRedisRestUrl = optional("UPSTASH_REDIS_REST_URL");
  const upstashRedisRestToken = optional("UPSTASH_REDIS_REST_TOKEN");
  if (Boolean(upstashRedisRestUrl) !== Boolean(upstashRedisRestToken)) {
    throw new Error("Invalid web host environment: UPSTASH Redis URL/token must be configured together");
  }

  return Object.freeze({
    nodeEnv: parseNodeEnv(),
    appUrl,
    trustedOrigins: Object.freeze(trustedOrigins),
    trustProxyHops: parseTrustProxyHops(),
    redisUrl: optional("REDIS_URL"),
    redisKeyPrefix: optional("REDIS_KEY_PREFIX") ?? "bke-development",
    upstashRedisRestUrl,
    upstashRedisRestToken,
  });
}

export function getCronEnvironment(): CronEnvironment {
  return Object.freeze({ cronSecret: required("CRON_SECRET", 32) });
}

export function getLegalPresentationEnvironment(): LegalPresentationEnvironment {
  const supportEmail = optional("SUPPORT_EMAIL") ?? "support@example.com";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail)) {
    throw new Error("Invalid web host environment: SUPPORT_EMAIL");
  }
  const businessAddress = optional("BUSINESS_ADDRESS") ?? "Business address to be supplied during legal review";
  if (businessAddress.length < 3 || businessAddress.length > 500) {
    throw new Error("Invalid web host environment: BUSINESS_ADDRESS");
  }
  return Object.freeze({
    appUrl: getWebHostEnvironment().appUrl,
    supportEmail,
    businessAddress,
  });
}

