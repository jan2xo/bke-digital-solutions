import { randomUUID } from "node:crypto";
import type { AuditWriteInput, RedactedAuditWriteInput } from "./contracts";
import { redactAuditMetadata } from "./redaction";

export interface AuditSqlExecutor {
  execute(statement: string, values?: readonly unknown[]): Promise<void>;
}

export async function writeAuditWithExecutor(
  executor: AuditSqlExecutor,
  input: AuditWriteInput,
): Promise<void> {
  const redacted: RedactedAuditWriteInput = Object.freeze({
    ...input,
    metadata: redactAuditMetadata(input.metadata ?? {}),
  });
  await executor.execute(
    `INSERT INTO "AuditLog"
       ("id", "actorId", "accountId", "action", "targetType", "targetId", "metadata", "createdAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())`,
    [
      randomUUID(),
      redacted.actorId ?? null,
      redacted.accountId ?? null,
      redacted.action,
      redacted.targetType,
      redacted.targetId ?? null,
      JSON.stringify(redacted.metadata ?? {}),
    ],
  );
}
