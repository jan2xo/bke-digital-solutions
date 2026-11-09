import { randomUUID } from "node:crypto";
import type { EmailOutboxStore, EmailProvider } from "./contracts";
import { EmailDeliveryError, safeEmailFailureCode } from "./failures";

export type EmailOutboxDispatchResult = Readonly<{
  selected: number;
  recovered: number;
  reviewRequired: number;
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
  const recovered = await dependencies.store.recoverExpiredClaims(claimedAt);
  const rows = await dependencies.store.listDispatchable({ limit, maxAttempts });

  let reviewRequired = recovered;
  let sent = 0;
  let failed = 0;
  let terminal = 0;
  let skipped = 0;

  for (const row of rows) {
    if ((row.status !== "PENDING" && row.status !== "FAILED") || row.attempts >= maxAttempts) {
      skipped++;
      continue;
    }

    const rowClaimedAt = clock();
    const claimed = await dependencies.store.claim({
      id: row.id,
      expectedStatus: row.status,
      expectedAttempts: row.attempts,
      workerId,
      claimedAt: rowClaimedAt,
      claimExpiresAt: new Date(rowClaimedAt.getTime() + claimTtlMs),
    });

    if (!claimed) {
      skipped++;
      continue;
    }

    let providerAccepted = false;
    try {
      await dependencies.provider.send({
        ...row.message,
        idempotencyKey: row.message.idempotencyKey ?? row.id,
      });

      providerAccepted = true;
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
      // A send may have succeeded before acknowledgement persistence failed.
      // Unknown transport outcomes and accepted-but-unrecorded sends stop here.
      const unconfirmed = providerAccepted || !(error instanceof EmailDeliveryError) ||
        error.policy.acceptance === "UNKNOWN";
      const stop = error instanceof EmailDeliveryError && error.policy.retry === "STOP";
      const permanentlyFailed = unconfirmed || stop || attempts >= maxAttempts;
      const completed = await dependencies.store.markFailed({
        id: row.id,
        workerId,
        status: permanentlyFailed ? "PERMANENTLY_FAILED" : "FAILED",
        attempts,
        failureCode: unconfirmed ? "DELIVERY_UNCONFIRMED" : failureCode(error),
      });

      if (completed) {
        failed++;
        if (permanentlyFailed) terminal++;
        if (unconfirmed) reviewRequired++;
      } else {
        skipped++;
      }
    }
  }

  const result = Object.freeze({
    selected: rows.length,
    recovered,
    reviewRequired,
    sent,
    failed,
    terminal,
    skipped,
    workerId,
  });

  options.log?.("email_outbox.dispatch", result);
  return result;
}
