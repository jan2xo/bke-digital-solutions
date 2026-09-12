import "server-only";

import type { ScheduledJob, ScheduledJobTrigger } from "@/v2/platform/scheduler";
import { createSchedulerEngine } from "@/v2/platform/scheduler";
import { schedulerJobDefinitions } from "@/v2/apps/web/scheduler/job-definitions";
import {
  commerceLifecycle,
  customerLifecycleReview,
  emailLifecycle,
  entitlementExpirations,
  paymentOperations,
  preparedRenewalRecovery,
  renewalReminders,
  securityCleanup,
  storageLifecycle,
} from "@/lib/scheduler/handlers";
import { backupCreation, backupRetention } from "@/lib/backups/scheduler";
import { schedulerStore } from "@/v2/platform/host/scheduler/store";
import { schedulerLockProvider } from "@/v2/platform/host/scheduler/lock-provider";
import { schedulerEventSink } from "@/v2/platform/host/scheduler/event-sink";

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

const scheduledJobs: ScheduledJob[] = schedulerJobDefinitions.map((definition) => {
  const handler = handlers.get(definition.key);
  if (!handler) throw new Error(`MISSING_SCHEDULER_JOB_HANDLER:${definition.key}`);
  return { ...definition, handler };
});

const engine = createSchedulerEngine({
  jobs: scheduledJobs,
  store: schedulerStore,
  locks: schedulerLockProvider,
  events: schedulerEventSink,
});

export function synchronizeScheduledJobs(now = new Date()) {
  return engine.synchronizeJobs(now);
}

export function runScheduledJob(input: Parameters<typeof engine.runJob>[0]) {
  return engine.runJob(input);
}

export function recoverAbandonedRuns(now = new Date()) {
  return engine.recoverAbandonedRuns(now);
}

export function runDueScheduledJobs(trigger: ScheduledJobTrigger = "CRON", now = new Date()) {
  return engine.runDueJobs(trigger, now);
}

export function setScheduledJobEnabled(key: string, enabled: boolean, actorId: string) {
  return engine.setJobEnabled(key, enabled, actorId);
}

export function acknowledgeScheduledFailure(runId: string, actorId: string) {
  return engine.acknowledgeFailure(runId, actorId);
}

export function retryScheduledFailure(runId: string, actorId: string) {
  return engine.retryFailure(runId, actorId);
}
