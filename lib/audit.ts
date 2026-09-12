import "server-only";
import { db } from "@/v2/platform/host/db";
import {redact} from "@/lib/redaction";
export async function audit(input: { actorId?: string; accountId?: string; action: string; targetType: string; targetId?: string; metadata?: unknown }) {
  return db.auditLog.create({ data: { ...input, metadata: redact(input.metadata ?? {}) as object } });
}
export { redact };
