export type AuditWriteInput = Readonly<{
  actorId?: string;
  accountId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  metadata?: unknown;
}>;

export type RedactedAuditWriteInput = Readonly<{
  actorId?: string;
  accountId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  metadata: unknown;
}>;

export interface AuditSink<Result = unknown> {
  write(input: RedactedAuditWriteInput): Promise<Result>;
}

export interface AuditPort<Result = unknown> {
  record(input: AuditWriteInput): Promise<Result>;
}
