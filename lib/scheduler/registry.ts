import "server-only";
import type { ScheduledJob } from "@/lib/scheduler/types";
import { commerceLifecycle, customerLifecycleReview, emailLifecycle, entitlementExpirations, paymentOperations, preparedRenewalRecovery, renewalReminders, securityCleanup, storageLifecycle } from "@/lib/scheduler/handlers";
import { backupCreation, backupRetention } from "@/lib/backups/scheduler";

const jobs = [
  { key: "storage.lifecycle", name: "Product storage cleanup", description: "Processes product-image/object cleanup and completed product deletion. Software installer intake is deferred.", category: "STORAGE", cadenceSeconds: 300, timeoutSeconds: 240, lockSeconds: 300, maxAttempts: 5, dryRunSupported: true, healthThresholdSeconds: 1800, auditPolicy: "FAILURES", handler: storageLifecycle },
  { key: "email.outbox", name: "Transactional email outbox", description: "Delivers pending mail, retries transient failures, and marks terminal failures.", category: "EMAIL", cadenceSeconds: 60, timeoutSeconds: 50, lockSeconds: 60, maxAttempts: 5, dryRunSupported: true, healthThresholdSeconds: 300, auditPolicy: "FAILURES", handler: emailLifecycle },
  { key: "subscriptions.renewal-reminders", name: "Subscription renewal reminders", description: "Queues deduplicated 14, 7, and 1 day customer-authorized renewal reminders.", category: "ENTITLEMENTS", cadenceSeconds: 3600, timeoutSeconds: 300, lockSeconds: 360, maxAttempts: 4, dryRunSupported: true, healthThresholdSeconds: 10800, auditPolicy: "FAILURES", handler: renewalReminders },
  { key: "entitlements.expiration", name: "Entitlement expiration", description: "Synchronizes subscription, license, trial, grace-period, and download-grant expiration state.", category: "ENTITLEMENTS", cadenceSeconds: 300, timeoutSeconds: 240, lockSeconds: 300, maxAttempts: 5, dryRunSupported: true, healthThresholdSeconds: 1800, auditPolicy: "FAILURES", handler: entitlementExpirations },
  { key: "commerce.lifecycle", name: "Commerce lifecycle", description: "Expires abandoned orders and attempts and releases stale offer reservations without settling payments.", category: "COMMERCE", cadenceSeconds: 900, timeoutSeconds: 120, lockSeconds: 180, maxAttempts: 4, dryRunSupported: true, healthThresholdSeconds: 3600, auditPolicy: "FAILURES", handler: commerceLifecycle },
  { key: "customers.retention-review", name: "Customer retention review", description: "Calculates retention, privacy, purge-eligibility, and legal-hold review backlogs without automatic purge.", category: "CUSTOMER", cadenceSeconds: 86400, timeoutSeconds: 300, lockSeconds: 360, maxAttempts: 3, dryRunSupported: true, healthThresholdSeconds: 172800, auditPolicy: "FAILURES", handler: customerLifecycleReview },
  { key: "security.expired-records", name: "Expired authentication records", description: "Removes expired sessions, MFA challenges, verification, magic-link, and password-reset tokens.", category: "SECURITY", cadenceSeconds: 3600, timeoutSeconds: 120, lockSeconds: 180, maxAttempts: 4, dryRunSupported: true, healthThresholdSeconds: 10800, auditPolicy: "FAILURES", handler: securityCleanup },
  { key: "payments.operations", name: "Payment operations", description: "Retries retryable stored webhooks and reports reconciliation candidates; never auto-settles or refunds.", category: "PAYMENTS", cadenceSeconds: 900, timeoutSeconds: 300, lockSeconds: 360, maxAttempts: 5, dryRunSupported: true, healthThresholdSeconds: 3600, auditPolicy: "ALL", handler: paymentOperations },
  { key: "renewals.prepared-recovery", name: "Prepared renewal recovery", description: "Retries prepared successor lease issuance without extending entitlements twice.", category: "ENTITLEMENTS", cadenceSeconds: 300, timeoutSeconds: 240, lockSeconds: 300, maxAttempts: 5, dryRunSupported: true, healthThresholdSeconds: 1800, auditPolicy: "ALL", handler: preparedRenewalRecovery },
  { key: "backups.daily", name: "Encrypted daily backup", description: "Queues one encrypted PostgreSQL and private-object archive per UTC retention window.", category: "BACKUP", cadenceSeconds: 86400, timeoutSeconds: 120, lockSeconds: 180, maxAttempts: 3, dryRunSupported: true, healthThresholdSeconds: 172800, auditPolicy: "ALL", handler: backupCreation },
  { key: "backups.retention", name: "Backup retention", description: "Marks expired archives and queues deletion without touching current recovery points.", category: "BACKUP", cadenceSeconds: 86400, timeoutSeconds: 120, lockSeconds: 180, maxAttempts: 3, dryRunSupported: true, healthThresholdSeconds: 172800, auditPolicy: "ALL", handler: backupRetention },
] satisfies ScheduledJob[];

const registry = new Map(jobs.map((job) => [job.key, job]));
if (registry.size !== jobs.length) throw new Error("DUPLICATE_SCHEDULER_JOB_KEY");
for (const job of jobs) {
  if (!/^[a-z][a-z0-9.-]+$/.test(job.key) || job.timeoutSeconds <= 0 || job.lockSeconds <= job.timeoutSeconds || job.maxAttempts < 1 || job.cadenceSeconds < 30) throw new Error(`INVALID_SCHEDULER_JOB:${job.key}`);
}

export const scheduledJobs = jobs;
export function scheduledJob(key: string) { const job = registry.get(key); if (!job) throw new Error("SCHEDULED_JOB_NOT_FOUND"); return job; }
