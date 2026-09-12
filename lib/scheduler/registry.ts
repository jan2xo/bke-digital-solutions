import "server-only";
import type { ScheduledJob } from "@/lib/scheduler/types";
import { schedulerJobDefinitions } from "@/v2/apps/web/scheduler/job-definitions";
import { commerceLifecycle, customerLifecycleReview, emailLifecycle, entitlementExpirations, paymentOperations, preparedRenewalRecovery, renewalReminders, securityCleanup, storageLifecycle } from "@/lib/scheduler/handlers";
import { backupCreation, backupRetention } from "@/lib/backups/scheduler";

const handlers = new Map<string, ScheduledJob["handler"]>([
  ["storage.lifecycle", storageLifecycle],
  ["email.outbox", emailLifecycle],
  ["subscriptions.renewal-reminders", renewalReminders],
  ["entitlements.expiration", entitlementExpirations],
  ["commerce.lifecycle", commerceLifecycle],
  ["customers.retention-review", customerLifecycleReview],
  ["security.expired-records", securityCleanup],
  ["payments.operations", paymentOperations],
  ["renewals.prepared-recovery", preparedRenewalRecovery],
  ["backups.daily", backupCreation],
  ["backups.retention", backupRetention],
]);

const jobs = schedulerJobDefinitions.map((definition) => {
  const handler = handlers.get(definition.key);
  if (!handler) throw new Error(`MISSING_SCHEDULER_JOB_HANDLER:${definition.key}`);
  return { ...definition, handler };
}) satisfies ScheduledJob[];

const registry = new Map(jobs.map((job) => [job.key, job]));
if (registry.size !== jobs.length) throw new Error("DUPLICATE_SCHEDULER_JOB_KEY");
for (const job of jobs) {
  if (!/^[a-z][a-z0-9.-]+$/.test(job.key) || job.timeoutSeconds <= 0 || job.lockSeconds <= job.timeoutSeconds || job.maxAttempts < 1 || job.cadenceSeconds < 30) throw new Error(`INVALID_SCHEDULER_JOB:${job.key}`);
}

export const scheduledJobs = jobs;
export function scheduledJob(key: string) { const job = registry.get(key); if (!job) throw new Error("SCHEDULED_JOB_NOT_FOUND"); return job; }
