import "server-only";

import { randomUUID } from "node:crypto";
import {
  createAuditPort,
  redactAuditMetadata,
  type AuditWriteInput,
  type RedactedAuditWriteInput,
} from "@/v2/platform/audit";
import { getPostgresPool } from "@/v2/apps/web/persistence/postgres";

export type WebAuditRecord = Readonly<{
  id: string;
  actorId: string | null;
  accountId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: unknown;
  createdAt: Date;
}>;

const port = createAuditPort<WebAuditRecord>({
  async write(input: RedactedAuditWriteInput): Promise<WebAuditRecord> {
    const id = randomUUID();
    const result = await getPostgresPool().query<WebAuditRecord>(
      `INSERT INTO "AuditLog"
         ("id", "actorId", "accountId", "action", "targetType", "targetId", "metadata", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
       RETURNING "id", "actorId", "accountId", "action", "targetType", "targetId", "metadata", "createdAt"`,
      [
        id,
        input.actorId ?? null,
        input.accountId ?? null,
        input.action,
        input.targetType,
        input.targetId ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    const record = result.rows[0];
    if (!record) throw new Error("AUDIT_WRITE_FAILED");
    return record;
  },
});

export function audit(input: AuditWriteInput): Promise<WebAuditRecord> {
  return port.record(input);
}

export const redact = redactAuditMetadata;
