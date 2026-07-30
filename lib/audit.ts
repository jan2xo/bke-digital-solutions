import "server-only";
import { db } from "@/lib/db";

const forbidden = /password|secret|token|license.?key|authorization/i;
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, forbidden.test(k) ? "[REDACTED]" : redact(v)]));
  return value;
}
export async function audit(input: { actorId?: string; accountId?: string; action: string; targetType: string; targetId?: string; metadata?: unknown }) {
  return db.auditLog.create({ data: { ...input, metadata: redact(input.metadata ?? {}) as object } });
}
export { redact };
