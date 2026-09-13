import "server-only";

import { createHmac, randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { Pool } from "pg";
import { clientIp } from "../http/request";

export type SecurityEventType =
  | "ADMIN_LOGIN_SUCCEEDED"
  | "ADMIN_LOGIN_FAILED"
  | "ADMIN_PASSWORD_ACCEPTED"
  | "ADMIN_PASSWORD_REJECTED"
  | "ADMIN_SESSION_CREATED"
  | "MFA_CHALLENGE_SUCCEEDED"
  | "MFA_CHALLENGE_FAILED"
  | "MFA_ENROLLED"
  | "MFA_DISABLED"
  | "MFA_RECOVERY_USED"
  | "MFA_RECOVERY_REGENERATED"
  | "RECENT_AUTH_SUCCEEDED"
  | "RECENT_AUTH_FAILED"
  | "ADMIN_SESSION_REVOKED"
  | "ADMIN_MAGIC_LOGIN_BLOCKED"
  | "MFA_ENROLLMENT_STARTED"
  | "PASSWORD_CHANGED"
  | "PASSWORD_RESET_COMPLETED"
  | "ADMIN_ALL_OTHER_SESSIONS_REVOKED"
  | "ADMIN_ALL_SESSIONS_REVOKED"
  | "SECURITY_RATE_LIMIT_TRIGGERED"
  | "PROVIDER_CREDENTIAL_REPLACED"
  | "PROVIDER_CREDENTIAL_REVOKED"
  | "PROVIDER_VALIDATION_SUCCEEDED"
  | "PROVIDER_VALIDATION_FAILED"
  | "LIVE_PAYMENT_ENABLE_BLOCKED"
  | "CUSTOMER_LIFECYCLE_CHANGED"
  | "CUSTOMER_PURGE_EXECUTED"
  | "STORAGE_CLEANUP_FAILED";

type SecurityEventOutcome = "SUCCESS" | "FAILURE" | "BLOCKED" | "INFORMATIONAL";
type SecurityEventSeverity = "INFORMATIONAL" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type SafeMetadata = Record<string, string | number | boolean>;
type Definition = {
  label: string;
  outcome: SecurityEventOutcome;
  severity: SecurityEventSeverity;
  explanation: string;
};

type SecurityEventOptions = {
  sessionId?: string;
  provider?: "PAYMONGO" | "RESEND";
  authenticationMethod?:
    | "PASSWORD"
    | "PASSWORD_TOTP"
    | "PASSWORD_EMAIL_OTP"
    | "PASSWORD_RECOVERY"
    | "MAGIC_LINK"
    | "MFA_ENROLLMENT";
};

const allowedMetadata = new Set([
  "reason",
  "count",
  "method",
  "result",
  "credentialType",
  "environment",
  "action",
]);

const defaults: Definition = {
  label: "Security activity",
  outcome: "INFORMATIONAL",
  severity: "LOW",
  explanation: "An administrator security action was recorded.",
};

const definitions: Partial<Record<SecurityEventType, Definition>> = {
  ADMIN_LOGIN_SUCCEEDED: { label: "Administrator signed in", outcome: "SUCCESS", severity: "LOW", explanation: "A password and MFA protected administrator sign-in completed." },
  ADMIN_LOGIN_FAILED: { label: "Administrator sign-in failed", outcome: "FAILURE", severity: "MEDIUM", explanation: "An administrator sign-in attempt did not complete." },
  ADMIN_PASSWORD_REJECTED: { label: "Administrator password rejected", outcome: "FAILURE", severity: "MEDIUM", explanation: "A password attempt for an administrator account was rejected." },
  ADMIN_SESSION_CREATED: { label: "New administrator session", outcome: "SUCCESS", severity: "LOW", explanation: "A new authenticated administrator session was created." },
  ADMIN_SESSION_REVOKED: { label: "Session revoked", outcome: "SUCCESS", severity: "MEDIUM", explanation: "An administrator session was explicitly revoked." },
  ADMIN_ALL_OTHER_SESSIONS_REVOKED: { label: "Other sessions revoked", outcome: "SUCCESS", severity: "HIGH", explanation: "All other administrator sessions were revoked." },
  ADMIN_ALL_SESSIONS_REVOKED: { label: "All sessions revoked", outcome: "SUCCESS", severity: "HIGH", explanation: "Every administrator session, including the current one, was revoked." },
  MFA_CHALLENGE_FAILED: { label: "MFA challenge failed", outcome: "FAILURE", severity: "MEDIUM", explanation: "An administrator MFA challenge was rejected." },
  MFA_CHALLENGE_SUCCEEDED: { label: "MFA challenge succeeded", outcome: "SUCCESS", severity: "LOW", explanation: "An administrator MFA challenge completed." },
  MFA_RECOVERY_USED: { label: "Recovery code used", outcome: "SUCCESS", severity: "HIGH", explanation: "An administrator recovery code was used to authenticate." },
  MFA_DISABLED: { label: "Administrator MFA disabled", outcome: "SUCCESS", severity: "HIGH", explanation: "Administrator MFA was disabled and must be enrolled again." },
  MFA_ENROLLED: { label: "Administrator email verification enabled", outcome: "SUCCESS", severity: "MEDIUM", explanation: "Administrator password-plus-email verification was enabled." },
  MFA_RECOVERY_REGENERATED: { label: "Recovery codes regenerated", outcome: "SUCCESS", severity: "HIGH", explanation: "Existing recovery codes were replaced." },
  PASSWORD_CHANGED: { label: "Administrator password changed", outcome: "SUCCESS", severity: "HIGH", explanation: "The administrator password changed and sessions were revoked." },
  PASSWORD_RESET_COMPLETED: { label: "Administrator password reset", outcome: "SUCCESS", severity: "HIGH", explanation: "A password reset completed for an administrator account." },
  SECURITY_RATE_LIMIT_TRIGGERED: { label: "Security rate limit triggered", outcome: "BLOCKED", severity: "MEDIUM", explanation: "Repeated security requests were temporarily blocked." },
  PROVIDER_CREDENTIAL_REPLACED: { label: "Provider credential replaced", outcome: "SUCCESS", severity: "HIGH", explanation: "An encrypted external-provider credential was replaced." },
  PROVIDER_CREDENTIAL_REVOKED: { label: "Provider credential revoked", outcome: "SUCCESS", severity: "HIGH", explanation: "An external-provider credential was revoked." },
  PROVIDER_VALIDATION_SUCCEEDED: { label: "Provider validation succeeded", outcome: "SUCCESS", severity: "LOW", explanation: "External-provider configuration validation completed." },
  PROVIDER_VALIDATION_FAILED: { label: "Provider validation failed", outcome: "FAILURE", severity: "MEDIUM", explanation: "External-provider configuration validation failed." },
  LIVE_PAYMENT_ENABLE_BLOCKED: { label: "Live payment enablement blocked", outcome: "BLOCKED", severity: "CRITICAL", explanation: "A forbidden live-payment enablement attempt was blocked." },
  CUSTOMER_LIFECYCLE_CHANGED: { label: "Customer lifecycle changed", outcome: "SUCCESS", severity: "HIGH", explanation: "An administrator changed customer access, retention, privacy, or legal-hold state." },
  CUSTOMER_PURGE_EXECUTED: { label: "Customer purge executed", outcome: "SUCCESS", severity: "CRITICAL", explanation: "An eligible pseudonymized customer record was irreversibly purged." },
  STORAGE_CLEANUP_FAILED: { label: "Storage cleanup failed", outcome: "FAILURE", severity: "HIGH", explanation: "A durable private-storage cleanup job exhausted its automatic retries." },
};

const globalForSecurityEvents = globalThis as typeof globalThis & {
  bkeV2SecurityEventPool?: Pool;
};

let cuidCounter = 0;
const cuidBase = 36;
const cuidBlockSize = 4;
const cuidDiscreteValues = cuidBase ** cuidBlockSize;
const cuidRandomLimit = 2 ** 32 - 1;

function pad(value: string, size: number) {
  const padded = `000000000${value}`;
  return padded.slice(padded.length - size);
}

function cuidRandomValue() {
  return Math.abs(randomBytes(4).readInt32BE() / cuidRandomLimit);
}

function cuidRandomBlock() {
  return pad(((cuidRandomValue() * cuidDiscreteValues) << 0).toString(cuidBase), cuidBlockSize);
}

function cuidFingerprint() {
  const pid = pad(process.pid.toString(cuidBase), 2);
  const host = hostname();
  const hostId = pad(
    host
      .split("")
      .reduce((previous, character) => previous + character.charCodeAt(0), host.length + 36)
      .toString(cuidBase),
    2,
  );
  return pid + hostId;
}

function createCuid() {
  cuidCounter = cuidCounter < cuidDiscreteValues ? cuidCounter : 0;
  const counter = cuidCounter;
  cuidCounter += 1;
  return `c${Date.now().toString(cuidBase)}${pad(counter.toString(cuidBase), cuidBlockSize)}${cuidFingerprint()}${cuidRandomBlock()}${cuidRandomBlock()}`;
}

function requiredRuntimeValue(name: "DATABASE_URL" | "SESSION_SECRET") {
  const value = process.env[name];
  if (!value) throw new Error(`Missing web host environment: ${name}`);
  return value;
}

function securityEventPool() {
  if (!globalForSecurityEvents.bkeV2SecurityEventPool) {
    globalForSecurityEvents.bkeV2SecurityEventPool = new Pool({ connectionString: requiredRuntimeValue("DATABASE_URL") });
  }
  return globalForSecurityEvents.bkeV2SecurityEventPool;
}

function hint(value: string) {
  return createHmac("sha256", requiredRuntimeValue("SESSION_SECRET")).update(value).digest("hex").slice(0, 16);
}

export function sanitizeSecurityMetadata(metadata?: SafeMetadata) {
  return Object.fromEntries(
    Object.entries(metadata ?? {})
      .filter(([key]) => allowedMetadata.has(key))
      .map(([key, value]) => [key, typeof value === "string" ? value.slice(0, 120) : value]),
  );
}

export function securityEventDefinition(type: SecurityEventType): Definition {
  return definitions[type] ?? defaults;
}

export async function securityEvent(
  type: SecurityEventType,
  request: Request,
  userId?: string,
  metadata?: SafeMetadata,
  options?: SecurityEventOptions,
) {
  const definition = securityEventDefinition(type);
  await securityEventPool().query(
    `INSERT INTO "SecurityEvent" (
      "id",
      "userId",
      "type",
      "outcome",
      "severity",
      "sessionId",
      "provider",
      "authenticationMethod",
      "ipHint",
      "userAgentHint",
      "metadata"
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
    [
      createCuid(),
      userId ?? null,
      type,
      definition.outcome,
      definition.severity,
      options?.sessionId ?? null,
      options?.provider ?? null,
      options?.authenticationMethod ?? null,
      hint(clientIp(request)),
      hint(request.headers.get("user-agent") ?? "unknown"),
      JSON.stringify(sanitizeSecurityMetadata(metadata)),
    ],
  );
}
