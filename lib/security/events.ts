import "server-only";
import { createHmac } from "node:crypto";
import type { SecurityEventType } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { clientIp } from "@/lib/security/request";
import { securityEventDefinition } from "@/lib/security/catalog";

type SafeMetadata = Record<string, string | number | boolean>;
const allowedMetadata = new Set(["reason", "count", "method", "result", "credentialType", "environment", "action"]);
export function sanitizeSecurityMetadata(metadata?: SafeMetadata) {
  return Object.fromEntries(Object.entries(metadata ?? {}).filter(([key]) => allowedMetadata.has(key)).map(([key, value]) => [key, typeof value === "string" ? value.slice(0, 120) : value]));
}

const hint = (value: string) => createHmac("sha256", env.SESSION_SECRET).update(value).digest("hex").slice(0, 16);
export async function securityEvent(type: SecurityEventType, request: Request, userId?: string, metadata?: SafeMetadata, options?: { sessionId?: string; provider?: "PAYMONGO" | "RESEND"; authenticationMethod?: "PASSWORD" | "PASSWORD_TOTP" | "PASSWORD_RECOVERY" | "MAGIC_LINK" | "MFA_ENROLLMENT" }) {
  const definition = securityEventDefinition(type);
  await db.securityEvent.create({ data: { type, outcome: definition.outcome, severity: definition.severity, userId, sessionId: options?.sessionId, provider: options?.provider, authenticationMethod: options?.authenticationMethod, ipHint: hint(clientIp(request)), userAgentHint: hint(request.headers.get("user-agent") ?? "unknown"), metadata: sanitizeSecurityMetadata(metadata) } });
}
