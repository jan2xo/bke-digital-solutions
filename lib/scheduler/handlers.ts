import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { env } from "@/lib/env";
import { db } from "@/lib/db";
import { dispatchEmailOutbox, queueCommerceEmail } from "@/lib/email";
import { finalizeProductDeletion } from "@/lib/product-deletion";
import { processReadyStorageCleanupJobs } from "@/lib/storage-cleanup";
import { retryStoredWebhook } from "@/lib/webhooks";
import { issueCommercialLease } from "@/v2/apps/web/licensing/commercial-lease";
import { decryptLicenseKey, sha256 } from "@/lib/security/crypto";
import type { JobContext, JobSummary } from "@/lib/scheduler/types";
import { processPendingCommissioning } from "@/lib/commissioning/service";

const DAY = 86_400_000;

export async function commissioningLifecycle(context: JobContext): Promise<JobSummary> {
  if (context.dryRun) return { pending: await db.commissioningRun.count({ where: { status: { in: ["PENDING", "FAILED"] } } }) };
  return processPendingCommissioning(10);
}

export async function storageLifecycle(context: JobContext): Promise<JobSummary> {
  const due = await db.storageCleanupJob.count({ where: { status: { in: ["PENDING", "RETRYING"] }, nextAttemptAt: { lte: context.now } } });
  const abandoned = await db.storageCleanupJob.count({ where: { status: "PROCESSING", startedAt: { lt: new Date(context.now.getTime() - 15 * 60_000) } } });
  const finalizable = await db.product.findMany({ where: { deletionRequestedAt: { not: null }, cleanupJobs: { every: { status: "SUCCEEDED" } } }, select: { id: true, cleanupJobs: { select: { createdByAdminId: true }, take: 1 } }, take: 20 });
  if (context.dryRun) return { due, abandoned, finalizable: finalizable.length };
  const results = await processReadyStorageCleanupJobs(100);
  let finalized = 0;
  for (const product of finalizable) {
    const actorId = product.cleanupJobs[0]?.createdByAdminId ?? (await db.auditLog.findFirst({ where: { action: "PRODUCT_DELETION_REQUESTED", targetId: product.id }, orderBy: { createdAt: "desc" }, select: { actorId: true } }))?.actorId;
    if (!actorId) continue;
    try { await finalizeProductDeletion({ productId: product.id, actorId }); finalized++; } catch { /* eligibility may have changed; next run re-evaluates */ }
  }
  return { due, abandoned, processed: results.length, finalized };
}

export async function emailLifecycle(context: JobContext): Promise<JobSummary> {
  const pending = await db.emailOutbox.count({ where: { status: { in: ["PENDING", "FAILED"] }, attempts: { lt: 5 } } });
  const terminal = await db.emailOutbox.count({ where: { OR: [{ status: "PERMANENTLY_FAILED" }, { status: "FAILED", attempts: { gte: 5 } }] } });
  if (context.dryRun) return { pending, terminal };
  const result = await dispatchEmailOutbox(100);
  await db.emailOutbox.updateMany({ where: { status: "FAILED", attempts: { gte: 5 } }, data: { status: "PERMANENTLY_FAILED" } });
  return { ...result, terminalBefore: terminal };
}

export async function renewalReminders(context: JobContext): Promise<JobSummary> {
  const subscriptions = await db.subscription.findMany({
    where: { status: "ACTIVE", account: { lifecycleState: "ACTIVE", owner: { emailVerified: { not: null }, suspendedAt: null } }, purchasePlan: { renewalBehavior: "CUSTOMER_AUTHORIZED" }, currentPeriodEnd: { gt: context.now, lte: new Date(context.now.getTime() + 14 * DAY) } },
    include: { account: { include: { owner: true } }, purchasePlan: true }, take: 500,
  });
  let eligible = 0, queued = 0;
  for (const subscription of subscriptions) {
    const days = Math.ceil((subscription.currentPeriodEnd.getTime() - context.now.getTime()) / DAY);
    const windows = subscription.purchasePlan?.type === "MONTHLY" ? [7, 1] : [14, 7, 1];
    const window = windows.find((candidate) => days <= candidate && days > candidate - 1);
    if (!window) continue;
    eligible++;
    if (context.dryRun) continue;
    const renewalUrl = new URL(`/dashboard/accounts/${subscription.accountId}#subscriptions`, env.APP_URL).toString();
    await db.$transaction(async (tx) => queueCommerceEmail(tx, { type: "RENEWAL_REMINDER", recipient: subscription.account.billingEmail, subject: `Your BKE subscription renews in ${window} day${window === 1 ? "" : "s"}`, payload: { subscriptionId: subscription.id, renewalUrl, windowDays: window }, deduplicationKey: `renewal-reminder:${subscription.id}:${subscription.currentPeriodEnd.toISOString()}:${window}` }));
    queued++;
  }
  return { candidates: subscriptions.length, eligible, queued };
}

export async function entitlementExpirations(context: JobContext): Promise<JobSummary> {
  const subscriptions = await db.subscription.findMany({ where: { status: { in: ["ACTIVE", "PAST_DUE"] }, currentPeriodEnd: { lte: context.now } }, include: { account: true }, take: 500 });
  const licenses = await db.license.findMany({ where: { status: "ACTIVE", expiresAt: { lte: context.now } }, include: { account: true, trialGrant: true }, take: 1000 });
  const endingTrials = await db.trialGrant.findMany({ where: { revokedAt: null, trialEndsAt: { gt: context.now, lte: new Date(context.now.getTime() + DAY) } }, include: { account: true }, take: 500 });
  const expiredGrants = await db.downloadGrant.count({ where: { expiresAt: { lte: context.now } } });
  const inactiveDevices = await db.deviceActivation.count({ where: { active: true, lastSeenAt: { lt: new Date(context.now.getTime() - 90 * DAY) } } });
  if (context.dryRun) return { subscriptions: subscriptions.length, licenses: licenses.length, endingTrials: endingTrials.length, expiredDownloadGrants: expiredGrants, inactiveDevicesForReview: inactiveDevices };
  await db.$transaction(async (tx) => {
    for (const subscription of subscriptions) {
      const changed = await tx.subscription.updateMany({ where: { id: subscription.id, status: { in: ["ACTIVE", "PAST_DUE"] }, currentPeriodEnd: { lte: context.now } }, data: { status: "EXPIRED" } });
      if (changed.count) await queueCommerceEmail(tx, { type: "SUBSCRIPTION_EXPIRED", recipient: subscription.account.billingEmail, subject: "Your BKE subscription has expired", payload: { subscriptionId: subscription.id }, deduplicationKey: `subscription-expired:${subscription.id}:${subscription.currentPeriodEnd.toISOString()}` });
    }
    for (const license of licenses) {
      const changed = await tx.license.updateMany({ where: { id: license.id, status: "ACTIVE", expiresAt: { lte: context.now } }, data: { status: "EXPIRED" } });
      if (!changed.count) continue;
      await tx.licenseEvent.createMany({ data: [{ licenseId: license.id, type: license.trialGrant ? "TRIAL_EXPIRED" : "LICENSE_EXPIRED", metadata: { scheduled: true } }], skipDuplicates: true });
      await tx.deviceActivation.updateMany({ where: { licenseId: license.id, active: true }, data: { active: false, deactivatedAt: context.now } });
      await queueCommerceEmail(tx, { type: license.trialGrant ? "TRIAL_EXPIRED" : "LICENSE_EXPIRED", recipient: license.account.billingEmail, subject: license.trialGrant ? "Your BKE trial has ended" : "Your BKE license has expired", payload: { licenseId: license.id }, deduplicationKey: `license-expired:${license.id}:${license.expiresAt?.toISOString() ?? "none"}` });
    }
    for (const trial of endingTrials) await queueCommerceEmail(tx, { type: "TRIAL_ENDING", recipient: trial.account.billingEmail, subject: "Your BKE trial ends soon", payload: { trialId: trial.id, trialEndsAt: trial.trialEndsAt.toISOString() }, deduplicationKey: `trial-ending:${trial.id}:${trial.trialEndsAt.toISOString()}` });
    await tx.downloadGrant.deleteMany({ where: { expiresAt: { lte: context.now } } });
    await tx.deviceActivation.updateMany({ where: { active: true, lastSeenAt: { lt: new Date(context.now.getTime() - 90 * DAY) } }, data: { active: false, deactivatedAt: context.now } });
  });
  return { subscriptions: subscriptions.length, licenses: licenses.length, endingTrials: endingTrials.length, expiredDownloadGrants: expiredGrants, inactiveDevicesForReview: inactiveDevices };
}

export async function subscriptionRenewals(context: JobContext): Promise<JobSummary> {
  const subscriptions = await db.subscription.findMany({ where: { status: "ACTIVE", currentPeriodEnd: { lte: context.now }, purchasePlan: { renewalBehavior: "AUTO_RENEW" } }, include: { account: true, purchasePlan: true }, take: 100 });
  if (context.dryRun) return { candidates: subscriptions.length };
  let renewed = 0, failed = 0;
  for (const subscription of subscriptions) {
    try {
      const operationId = `renewal:${subscription.id}:${subscription.currentPeriodEnd.toISOString()}`;
      const operation = await db.commercialLeaseOperation.findUnique({ where: { operationId } });
      if (operation?.status === "COMPLETED") { renewed++; continue; }
      const license = await db.license.findFirst({ where: { subscriptionId: subscription.id, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
      if (!license?.keyCiphertext) throw new Error("RENEWAL_LICENSE_UNAVAILABLE");
      const predecessor = await db.licenseLeaseRecord.findFirst({ where: { licenseId: license.id, status: "ACTIVE" }, orderBy: [{ generation: "desc" }, { serverRevision: "desc" }] });
      if (!predecessor) throw new Error("RENEWAL_LEASE_UNAVAILABLE");
      await db.commercialLeaseOperation.upsert({ where: { operationId }, create: { operationId, licenseId: license.id, action: "RENEWAL", status: "PREPARED", metadata: { subscriptionId: subscription.id, installationId: predecessor.installationId, deviceId: predecessor.deviceId, predecessorLeaseId: predecessor.leaseId } }, update: {} });
      await issueCommercialLease({ licenseKey: decryptLicenseKey(license.keyCiphertext), installationId: predecessor.installationId, deviceId: predecessor.deviceId, operationId, productVersion: predecessor.version, action: "RENEWAL", predecessorLeaseId: predecessor.leaseId });
      await db.subscription.update({ where: { id: subscription.id }, data: { currentPeriodStart: subscription.currentPeriodEnd, currentPeriodEnd: new Date(subscription.currentPeriodEnd.getTime() + subscription.purchasePlan.intervalMonths * 30 * DAY) } });
      renewed++;
    } catch { failed++; }
  }
  return { candidates: subscriptions.length, renewed, failed };
}

export async function webhookRetries(context: JobContext): Promise<JobSummary> {
  const retries = await db.webhookEvent.findMany({ where: { status: "FAILED", resolutionStatus: "OPEN" }, select: { externalEventId: true }, take: 100 });
  if (context.dryRun) return { candidates: retries.length };
  let retried = 0, failed = 0;
  for (const row of retries) {
    try { await retryStoredWebhook(row.externalEventId); retried++; } catch { failed++; }
  }
  return { candidates: retries.length, retried, failed };
}
