import type { AuditPort, AuditSink, AuditWriteInput } from "./contracts";
import { redactAuditMetadata } from "./redaction";

export function createAuditPort<Result>(sink: AuditSink<Result>): AuditPort<Result> {
  return Object.freeze({
    async record(input: AuditWriteInput): Promise<Result> {
      return sink.write({
        actorId: input.actorId,
        accountId: input.accountId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        metadata: redactAuditMetadata(input.metadata ?? {}),
      });
    },
  });
}
