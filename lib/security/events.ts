import "server-only";
import { createHmac } from "node:crypto";
import type { SecurityEventType } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { clientIp } from "@/lib/security/request";

const hint = (value: string) => createHmac("sha256", env.SESSION_SECRET).update(value).digest("hex").slice(0, 16);
export async function securityEvent(type: SecurityEventType, request: Request, userId?: string, metadata?: Record<string, string | number | boolean>) {
  await db.securityEvent.create({ data: { type, userId, ipHint: hint(clientIp(request)), userAgentHint: hint(request.headers.get("user-agent") ?? "unknown"), metadata } });
}
