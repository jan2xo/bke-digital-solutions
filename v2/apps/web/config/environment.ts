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

export interface ObjectStorageEnvironment {
  readonly endpoint?: string;
  readonly publicUploadEndpoint?: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
  readonly forcePathStyle: boolean;
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

function parseBoolean(name: string, fallback: boolean): boolean {
  const value = optional(name);
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Invalid web host environment: ${name}`);
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

function optionalUrl(name: string): string | undefined {
  const value = optional(name);
  if (!value) return undefined;
  canonicalOrigin(value, name);
  return value;
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

export function getObjectStorageEnvironment(): ObjectStorageEnvironment {
  const accessKeyId = optional("S3_ACCESS_KEY_ID");
  const secretAccessKey = optional("S3_SECRET_ACCESS_KEY");
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    throw new Error("Invalid web host environment: S3 credentials must be configured together");
  }
  return Object.freeze({
    endpoint: optionalUrl("S3_ENDPOINT"),
    publicUploadEndpoint: optionalUrl("S3_PUBLIC_UPLOAD_ENDPOINT"),
    region: optional("S3_REGION") ?? "auto",
    bucket: required("S3_BUCKET", 3),
    accessKeyId,
    secretAccessKey,
    forcePathStyle: parseBoolean("S3_FORCE_PATH_STYLE", true),
  });
}
