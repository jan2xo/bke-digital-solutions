import type { BackupRetentionTier } from "@/generated/prisma/client";

export function retentionTier(now: Date): BackupRetentionTier {
  if (now.getUTCDate() === 1) return "MONTHLY";
  if (now.getUTCDay() === 0) return "WEEKLY";
  return "DAILY";
}

export function expiresAt(tier: BackupRetentionTier, now: Date, policy: { daily: number; weekly: number; monthly: number }) {
  if (tier === "MANUAL") return null;
  const result = new Date(now);
  if (tier === "DAILY") result.setUTCDate(result.getUTCDate() + policy.daily);
  if (tier === "WEEKLY") result.setUTCDate(result.getUTCDate() + policy.weekly * 7);
  if (tier === "MONTHLY") result.setUTCMonth(result.getUTCMonth() + policy.monthly);
  return result;
}

export function retryAt(attempt: number, now = new Date()) {
  return new Date(now.getTime() + Math.min(60 * 60_000, 30_000 * (2 ** Math.max(0, attempt - 1))));
}

export const RESTORE_CONFIRMATION_PREFIX = "RESTORE TO ISOLATED TARGET";

export function validateRestoreConfirmation(backupId: string, confirmation: string) {
  return confirmation === `${RESTORE_CONFIRMATION_PREFIX} ${backupId}`;
}
