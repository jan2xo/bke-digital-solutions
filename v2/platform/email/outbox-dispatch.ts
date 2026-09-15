import { randomUUID } from "node:crypto";
import type { EmailOutboxStore, EmailProvider } from "./contracts";
import { safeEmailFailureCode } from "./failures";

export type EmailOutboxDispatchResult = Readonly<{
  selected: number;
  recovered: number;
  sent: number;
  failed: number;
  terminal: number;
  skipped: number;
  workerId: string;
}>;

export type EmailOutboxDispatchOptions = Readonly<{
  limit?: number;
  workerId?: string;
  claimTtlMs?: number;
  maxAttempts?: number;
  now?: () => Date;
  failureCode?: (error: unknown) => string;
  log?: (event: string, result: EmailOutboxDispatchResult) => void;
}>;

export async function dispatchEmailOutbox(
  dependencies: Readonly<{ store: EmailOutboxStore; provider: EmailProvider }>,
  options: EmailOutboxDispatchOptions = {},
): Promise<EmailOutboxDispatchResult> {
  const limit = options.limit ?? 20;
  const maxAttempts = options.maxAttempts ?? 5;
  const claimTtlMs = options.claimTtlMs ?? 5 * 60_000;
  const workerId = options.workerId ?? `email-worker:${randomUUID()}`;
  const clock = options.now ?? (() => new Date());
  const failureCode = options.failureCode ?? safeEmailFailureCode;

  const claimedAt = clock();
  const claimExpiresAt = new Date(claimedAt.getTime() + claimTtlMs);
  const recovered = await dependencies.store.recoverExpiredClaims(claimedAt);
  const rows = await dependencies.store.listDispatchable({ limit, maxAttempts });

  let sent = 0;
  let failed = 0;
  let terminal = 0;
  let skipped = 0;

  for (const row of rows) {
    if ((row.status !== "PENDING" && row.status !== "FAILED") || row.attempts >= maxAttempts) {
      skipped++;
      continue;
    }

    const claimed = await dependencies.store.claim({
      id: row.id,
      expectedStatus: row.status,
      expectedAttempts: row.attempts,
      workerId,
      claimedAt,
      claimExpiresAt,
    });

    if (!claimed) {
      skipped++;
      continue;
    }

    try {
      await dependencies.provider.send({
        ...row.message,
        idempotencyKey: row.message.idempotencyKey ?? row.id,
      });

      const completed = await dependencies.store.markSent({
        id: row.id,
        workerId,
        sentAt: clock(),
        attempts: row.attempts + 1,
      });

      if (completed) sent++;
      else skipped++;
    } catch (error) {
      const attempts = row.attempts + 1;
      const permanentlyFailed = attempts >= maxAttempts;
      const completed = await dependencies.store.markFailed({
        id: row.id,
        workerId,
        status: permanentlyFailed ? "PERMANENTLY_FAILED" : "FAILED",
        attempts,
        failureCode: failureCode(error),
      });

      if (completed) {
        failed++;
        if (permanentlyFailed) terminal++;
      } else {
        skipped++;
      }
    }
  }

  const result = Object.freeze({
    selected: rows.length,
    recovered,
    sent,
    failed,
    terminal,
    skipped,
    workerId,
  });

  options.log?.("email_outbox.dispatch", result);
  return result;
}
