import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { env } from "@/lib/env";
import { db } from "@/lib/db";
import { dispatchEmailOutbox, queueCommerceEmail } from "@/lib/email";
import { finalizeProductDeletion } from "@/lib/product-deletion";
import { processReadyStorageCleanupJobs } from "@/lib/storage-cleanup";
import { retryStoredWebhook } from "@/lib/webhooks";
import { issueCommercialLease } from "@/lib/licensing/commercial-lease";
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
      await queueCommerceEmail(tx, { type: license.trialGrant ? "TRIAL_EXPIRED" : "LICENSE_EXPIRED", recipient: license.account.billingEmail, subject: license.trialGrant ? "Your BKE trial has expired" : "Your BKE license has expired", payload: { licenseId: license.id }, deduplicationKey: `entitlement-expired:${license.id}:${license.expiresAt?.toISOString()}` });
    }
    for (const trial of endingTrials) await queueCommerceEmail(tx, { type: "TRIAL_ENDING", recipient: trial.account.billingEmail, subject: "Your BKE trial ends soon", payload: { trialId: trial.id }, deduplicationKey: `trial-ending:${trial.id}:${trial.trialEndsAt.toISOString()}:1` });
    await tx.downloadGrant.deleteMany({ where: { expiresAt: { lte: context.now } } });
  });
  return { expiredSubscriptions: subscriptions.length, expiredLicenses: licenses.length, trialReminders: endingTrials.length, deletedDownloadGrants: expiredGrants, inactiveDevicesForReview: inactiveDevices };
}

export async function commerceLifecycle(context: JobContext): Promise<JobSummary> {
  const cutoff = new Date(context.now.getTime() - DAY);
  const orders = await db.order.count({ where: { status: "PENDING", createdAt: { lt: cutoff } } });
  const staleAttemptWhere = { status: { in: ["CREATING", "PENDING"] }, createdAt: { lt: cutoff }, order: { status: "PENDING" } } satisfies Prisma.PaymentAttemptWhereInput;
  const attempts = await db.paymentAttempt.count({ where: staleAttemptWhere });
  const reservations = await db.offerRedemption.count({ where: { status: "RESERVED", reservedAt: { lt: cutoff } } });
  if (context.dryRun) return { abandonedOrders: orders, stalePaymentAttempts: attempts, staleOfferReservations: reservations };
  const [, expiredAttempts, released] = await db.$transaction([
    db.order.updateMany({ where: { status: "PENDING", createdAt: { lt: cutoff } }, data: { status: "CANCELLED" } }),
    db.paymentAttempt.updateMany({ where: staleAttemptWhere, data: { status: "EXPIRED" } }),
    db.offerRedemption.updateMany({ where: { status: "RESERVED", reservedAt: { lt: cutoff } }, data: { status: "RELEASED", releasedAt: context.now } }),
  ]);
  return { expiredOrders: orders, expiredPaymentAttempts: expiredAttempts.count, releasedReservations: released.count };
}

export async function customerLifecycleReview(context: JobContext): Promise<JobSummary> {
  const retentionDue = await db.user.count({ where: { lifecycleState: { in: ["PRIVACY_REVIEW", "PSEUDONYMIZED"] }, retentionExpiresAt: { lte: context.now }, legalHoldAt: null } });
  const legalHolds = await db.user.count({ where: { legalHoldAt: { not: null }, lifecycleState: { not: "ACTIVE" } } });
  const privacyPending = await db.user.count({ where: { lifecycleState: "PRIVACY_REVIEW" } });
  if (!context.dryRun && (retentionDue || legalHolds || privacyPending)) {
    const admins = await db.user.findMany({ where: { role: "ADMIN", emailVerified: { not: null }, suspendedAt: null }, select: { id: true, email: true }, take: 20 });
    const day = context.now.toISOString().slice(0, 10);
    await db.$transaction(async (tx) => { for (const admin of admins) await queueCommerceEmail(tx, { type: "CUSTOMER_LIFECYCLE_REVIEW", recipient: admin.email, subject: "BKE customer lifecycle review is due", payload: { retentionDue, legalHolds, privacyPending }, deduplicationKey: `customer-lifecycle-review:${day}:${admin.id}` }); });
  }
  return { retentionDue, legalHoldsForReview: legalHolds, privacyReviews: privacyPending, automaticPurge: false };
}

export async function securityCleanup(context: JobContext): Promise<JobSummary> {
  const sessionWhere = { OR: [{ expiresAt: { lte: context.now } }, { absoluteExpiresAt: { lte: context.now } }] };
  const counts = await Promise.all([
    db.session.count({ where: sessionWhere }), db.mfaChallenge.count({ where: { expiresAt: { lte: context.now } } }),
    db.verificationToken.count({ where: { expiresAt: { lte: context.now } } }), db.passwordResetToken.count({ where: { expiresAt: { lte: context.now } } }),
  ]);
  if (context.dryRun) return { sessions: counts[0], mfaChallenges: counts[1], verificationTokens: counts[2], passwordResetTokens: counts[3] };
  const [sessions, mfa, verification, reset] = await db.$transaction([
    db.session.deleteMany({ where: sessionWhere }), db.mfaChallenge.deleteMany({ where: { expiresAt: { lte: context.now } } }),
    db.verificationToken.deleteMany({ where: { expiresAt: { lte: context.now } } }), db.passwordResetToken.deleteMany({ where: { expiresAt: { lte: context.now } } }),
  ]);
  return { sessions: sessions.count, mfaChallenges: mfa.count, verificationTokens: verification.count, passwordResetTokens: reset.count };
}

export async function paymentOperations(context: JobContext): Promise<JobSummary> {
  const failed = await db.webhookEvent.findMany({ where: { status: "FAILED", resolutionStatus: "OPEN", lastErrorCode: { in: ["PAYMENT_PROCESSING_RETRYABLE", "PAYMENT_PROVIDER_UNAVAILABLE"] } }, select: { id: true }, orderBy: { receivedAt: "asc" }, take: 20 });
  const reconciliationCandidates = await db.payment.count({ where: { provider: "paymongo", status: { in: ["PENDING", "PAID", "REFUNDED"] }, reconciliations: { none: {} } } });
  if (context.dryRun) return { retryableWebhooks: failed.length, reconciliationCandidates, automaticSettlement: false };
  let retried = 0, failedRetries = 0;
  for (const webhook of failed) { try { await retryStoredWebhook(webhook.id); retried++; } catch { failedRetries++; } }
  if (reconciliationCandidates) {
    const admins = await db.user.findMany({ where: { role: "ADMIN", emailVerified: { not: null }, suspendedAt: null }, select: { id: true, email: true }, take: 20 });
    const day = context.now.toISOString().slice(0, 10);
    await db.$transaction(async (tx) => { for (const admin of admins) await queueCommerceEmail(tx, { type: "PAYMENT_RECONCILIATION_REVIEW", recipient: admin.email, subject: "BKE payment reconciliation review is due", payload: { candidateCount: reconciliationCandidates }, deduplicationKey: `payment-reconciliation-review:${day}:${admin.id}` }); });
  }
  return { retriedWebhooks: retried, failedRetries, reconciliationReminders: reconciliationCandidates, automaticSettlement: false };
}

/** Retries prepared renewal lease issuance without re-extending entitlement. */
export async function preparedRenewalRecovery(context: JobContext): Promise<JobSummary> {
  const operations = await db.commercialLeaseOperation.findMany({ where: { action: "RENEWAL", status: "PREPARED" }, orderBy: { createdAt: "asc" }, take: 20, include: { license: { select: { keyCiphertext: true, activations: { where: { active: true }, select: { deviceHash: true } }, leaseHistory: { where: { status: "ACTIVE" }, orderBy: { issuedAt: "desc" }, select: { installationId: true, deviceId: true, version: true } } } } } });
  if (context.dryRun) return { candidates: operations.length };
  let completed = 0, failed = 0;
  for (const operation of operations) {
    const metadata = (operation.metadata ?? {}) as Record<string, unknown>;
    const activation = operation.license?.activations.find((a) => a.deviceHash === String(metadata.deviceHash ?? ""));
    const binding = operation.license?.leaseHistory.find((lease) => activation && sha256(lease.deviceId) === activation.deviceHash);
    if (!operation.license?.keyCiphertext || !binding) { failed++; continue; }
    try { await issueCommercialLease({ licenseKey: decryptLicenseKey(operation.license.keyCiphertext), installationId: binding.installationId, deviceId: binding.deviceId, operationId: operation.operationId, productVersion: binding.version, action: "RENEWAL" }); completed++; }
    catch { failed++; }
  }
  return { candidates: operations.length, completed, failed };
}
