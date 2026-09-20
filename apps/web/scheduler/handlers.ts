import "server-only";
import type { Prisma } from "@/platform/persistence/generated/prisma/client";
import { db } from "@/platform/host/db";
import { dispatchEmailOutbox } from "@/apps/web/email";
import { finalizeProductDeletion } from "@/apps/web/catalog/product-deletion";
import { processReadyStorageCleanupJobs } from "@/apps/web/storage/cleanup";
import { retryStoredWebhook } from "@/apps/web/payments/webhook-processing";
import { persistNotification } from "@/apps/web/notifications/center";
import { issueCommercialLease } from "@/apps/web/licensing/commercial-lease";
import { decryptLicenseKey, sha256 } from "@/platform/host/security/crypto";
import type { JobContext, JobSummary } from "@/platform/scheduler";

const DAY = 86_400_000;
const dayKey = (value: Date) => value.toISOString().slice(0, 10);

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

const RETIRED_COMMERCE_EMAIL_TYPES = [
  "PAYMENT_RECEIPT",
  "LICENSE_ISSUED",
  "PAYMENT_FAILED",
  "REFUND_CONFIRMED",
  "RENEWAL_REMINDER",
  "SUBSCRIPTION_EXPIRED",
  "TRIAL_ENDING",
  "TRIAL_EXPIRED",
  "LICENSE_EXPIRED",
  "CUSTOMER_LIFECYCLE_REVIEW",
  "PAYMENT_RECONCILIATION_REVIEW",
] as const;

export async function emailLifecycle(context: JobContext): Promise<JobSummary> {
  const retired = await db.emailOutbox.count({
    where: {
      type: { in: [...RETIRED_COMMERCE_EMAIL_TYPES] },
      status: { in: ["PENDING", "FAILED"] },
    },
  });
  const pending = await db.emailOutbox.count({
    where: {
      type: {
        in: [
          "INVOICE_ISSUED",
          "SECURITY_SESSIONS_REVOKED",
          "SECURITY_NEW_SESSION",
          "SECURITY_ACCOUNT_CHANGED",
        ],
      },
      status: { in: ["PENDING", "FAILED"] },
      attempts: { lt: 5 },
    },
  });
  const terminal = await db.emailOutbox.count({
    where: {
      OR: [
        { status: "PERMANENTLY_FAILED" },
        { status: "FAILED", attempts: { gte: 5 } },
      ],
    },
  });
  if (context.dryRun) return { pending, terminal, retired };

  const retiredResult = await db.emailOutbox.updateMany({
    where: {
      type: { in: [...RETIRED_COMMERCE_EMAIL_TYPES] },
      status: { in: ["PENDING", "FAILED"] },
    },
    data: {
      status: "PERMANENTLY_FAILED",
      lastError: "EMAIL_CHANNEL_RETIRED",
      claimedBy: null,
      claimedAt: null,
      claimExpiresAt: null,
    },
  });

  const result = await dispatchEmailOutbox(100);
  await db.emailOutbox.updateMany({
    where: { status: "FAILED", attempts: { gte: 5 } },
    data: { status: "PERMANENTLY_FAILED" },
  });
  return {
    ...result,
    terminalBefore: terminal,
    retired: retiredResult.count,
  };
}

export async function renewalReminders(context: JobContext): Promise<JobSummary> {
  const subscriptions = await db.subscription.findMany({
    where: {
      status: "ACTIVE",
      account: {
        lifecycleState: "ACTIVE",
        owner: { emailVerified: { not: null }, suspendedAt: null },
      },
      purchasePlan: { renewalBehavior: "CUSTOMER_AUTHORIZED" },
      currentPeriodEnd: {
        gt: context.now,
        lte: new Date(context.now.getTime() + 14 * DAY),
      },
    },
    include: { purchasePlan: true },
    take: 500,
  });

  const eligible: Array<{ subscription: (typeof subscriptions)[number]; window: number }> = [];
  for (const subscription of subscriptions) {
    const days = Math.ceil(
      (subscription.currentPeriodEnd.getTime() - context.now.getTime()) / DAY,
    );
    const windows = subscription.purchasePlan?.type === "MONTHLY"
      ? [7, 1]
      : [14, 7, 1];
    const window = windows.find(
      (candidate) => days <= candidate && days > candidate - 1,
    );
    if (window) eligible.push({ subscription, window });
  }

  if (!context.dryRun && eligible.length) {
    await db.$transaction(async (tx) => {
      for (const { subscription, window } of eligible) {
        await persistNotification(tx, {
          source: {
            moduleId: "commerce",
            event: "RENEWAL_APPROACHING",
            sourceReference: subscription.id,
          },
          audience: { kind: "ACCOUNT", accountId: subscription.accountId },
          content: {
            title: "Renewal approaching",
            body: `Your subscription period ends in about ${window} day${window === 1 ? "" : "s"}. Renew from your customer portal when ready.`,
            category: "TRANSACTIONAL",
            data: {
              subscriptionId: subscription.id,
              windowDays: window,
              currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
            },
          },
          context: {
            trigger: "CUSTOM",
            placementHint: "product-inbox",
          },
          priority: window === 1 ? "HIGH" : "NORMAL",
          idempotencyKey: `renewal-approaching:${subscription.id}:${subscription.currentPeriodEnd.toISOString()}:${window}`,
          expiresAt: subscription.currentPeriodEnd,
          productId: subscription.productId,
          createdAt: context.now,
        });
      }
    });
  }

  return {
    candidates: subscriptions.length,
    eligible: eligible.length,
    emailQueued: 0,
    notificationsQueued: context.dryRun ? 0 : eligible.length,
    delivery: "durable-notification-center",
  };
}
export async function entitlementExpirations(context: JobContext): Promise<JobSummary> {
  const subscriptions = await db.subscription.findMany({
    where: {
      status: { in: ["ACTIVE", "PAST_DUE"] },
      currentPeriodEnd: { lte: context.now },
    },
    take: 500,
  });
  const licenses = await db.license.findMany({
    where: { status: "ACTIVE", expiresAt: { lte: context.now } },
    include: { trialGrant: true },
    take: 1000,
  });
  const endingTrials = await db.trialGrant.findMany({
    where: {
      revokedAt: null,
      trialEndsAt: {
        gt: context.now,
        lte: new Date(context.now.getTime() + DAY),
      },
    },
    select: {
      id: true,
      accountId: true,
      productId: true,
      trialEndsAt: true,
    },
    take: 1000,
  });
  const expiredGrants = await db.downloadGrant.count({
    where: { expiresAt: { lte: context.now } },
  });
  const inactiveDevices = await db.deviceActivation.count({
    where: {
      active: true,
      lastSeenAt: { lt: new Date(context.now.getTime() - 90 * DAY) },
    },
  });

  if (context.dryRun) {
    return {
      subscriptions: subscriptions.length,
      licenses: licenses.length,
      endingTrials: endingTrials.length,
      expiredDownloadGrants: expiredGrants,
      inactiveDevicesForReview: inactiveDevices,
      emailQueued: 0,
    };
  }

  let notificationCount = 0;
  await db.$transaction(async (tx) => {
    for (const trial of endingTrials) {
      await persistNotification(tx, {
        source: {
          moduleId: "trials",
          event: "TRIAL_ENDING",
          sourceReference: trial.id,
        },
        audience: { kind: "ACCOUNT", accountId: trial.accountId },
        content: {
          title: "Trial ending soon",
          body: "Your product trial is approaching its end. Review purchase options in your customer portal.",
          category: "LICENSE",
          data: {
            trialId: trial.id,
            trialEndsAt: trial.trialEndsAt.toISOString(),
          },
        },
        context: {
          trigger: "LICENSE_EVENT",
          placementHint: "product-inbox",
        },
        priority: "NORMAL",
        idempotencyKey: `trial-ending:${trial.id}:${trial.trialEndsAt.toISOString()}`,
        expiresAt: trial.trialEndsAt,
        productId: trial.productId,
        createdAt: context.now,
      });
      notificationCount += 1;
    }

    for (const subscription of subscriptions) {
      const changed = await tx.subscription.updateMany({
        where: {
          id: subscription.id,
          status: { in: ["ACTIVE", "PAST_DUE"] },
          currentPeriodEnd: { lte: context.now },
        },
        data: { status: "EXPIRED" },
      });
      if (!changed.count) continue;
      await persistNotification(tx, {
        source: {
          moduleId: "commerce",
          event: "SUBSCRIPTION_EXPIRED",
          sourceReference: subscription.id,
        },
        audience: { kind: "ACCOUNT", accountId: subscription.accountId },
        content: {
          title: "Subscription expired",
          body: "Your subscription period has expired. Review your current access and renewal options.",
          category: "TRANSACTIONAL",
          data: {
            subscriptionId: subscription.id,
            currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
          },
        },
        context: {
          trigger: "CUSTOM",
          placementHint: "product-inbox",
        },
        priority: "HIGH",
        idempotencyKey: `subscription-expired:${subscription.id}:${subscription.currentPeriodEnd.toISOString()}`,
        productId: subscription.productId,
        createdAt: subscription.currentPeriodEnd,
      });
      notificationCount += 1;
    }

    for (const license of licenses) {
      const changed = await tx.license.updateMany({
        where: {
          id: license.id,
          status: "ACTIVE",
          expiresAt: { lte: context.now },
        },
        data: { status: "EXPIRED" },
      });
      if (!changed.count) continue;
      await tx.licenseEvent.createMany({
        data: [{
          licenseId: license.id,
          type: license.trialGrant ? "TRIAL_EXPIRED" : "LICENSE_EXPIRED",
          metadata: { scheduled: true },
        }],
        skipDuplicates: true,
      });

      if (license.trialGrant) {
        await persistNotification(tx, {
          source: {
            moduleId: "trials",
            event: "TRIAL_EXPIRED",
            sourceReference: license.trialGrant.id,
          },
          audience: { kind: "ACCOUNT", accountId: license.accountId },
          content: {
            title: "Trial ended",
            body: "Your product trial has ended. Review your entitlement or available purchase options.",
            category: "LICENSE",
            data: {
              trialId: license.trialGrant.id,
              licenseId: license.id,
            },
          },
          context: {
            trigger: "LICENSE_EVENT",
            placementHint: "product-inbox",
          },
          priority: "HIGH",
          idempotencyKey: `trial-expired:${license.trialGrant.id}`,
          productId: license.productId,
          createdAt: license.expiresAt ?? context.now,
        });
      } else {
        await persistNotification(tx, {
          source: {
            moduleId: "licensing",
            event: "LICENSE_EXPIRED",
            sourceReference: license.id,
          },
          audience: { kind: "ACCOUNT", accountId: license.accountId },
          content: {
            title: "License expired",
            body: "This license has expired. Review your current access in the customer portal.",
            category: "LICENSE",
            data: { licenseId: license.id },
          },
          context: {
            trigger: "LICENSE_EVENT",
            placementHint: "product-inbox",
          },
          priority: "HIGH",
          idempotencyKey: `license-expired:${license.id}:${license.expiresAt?.toISOString() ?? "unknown"}`,
          productId: license.productId,
          createdAt: license.expiresAt ?? context.now,
        });
      }
      notificationCount += 1;
    }

    await tx.downloadGrant.deleteMany({
      where: { expiresAt: { lte: context.now } },
    });
  });

  return {
    expiredSubscriptions: subscriptions.length,
    expiredLicenses: licenses.length,
    trialReminders: endingTrials.length,
    deletedDownloadGrants: expiredGrants,
    inactiveDevicesForReview: inactiveDevices,
    emailQueued: 0,
    notificationsQueued: notificationCount,
    delivery: "durable-notification-center",
  };
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
  const retentionDue = await db.user.count({
    where: {
      lifecycleState: { in: ["PRIVACY_REVIEW", "PSEUDONYMIZED"] },
      retentionExpiresAt: { lte: context.now },
      legalHoldAt: null,
    },
  });
  const legalHolds = await db.user.count({
    where: {
      legalHoldAt: { not: null },
      lifecycleState: { not: "ACTIVE" },
    },
  });
  const privacyPending = await db.user.count({
    where: { lifecycleState: "PRIVACY_REVIEW" },
  });

  const reviewRequired = retentionDue > 0 || legalHolds > 0 || privacyPending > 0;
  if (!context.dryRun && reviewRequired) {
    await db.$transaction((tx) => persistNotification(tx, {
      source: {
        moduleId: "privacy",
        event: "CUSTOMER_LIFECYCLE_REVIEW",
      },
      audience: { kind: "ADMINISTRATORS" },
      content: {
        title: "Customer lifecycle review required",
        body: `Retention due: ${retentionDue}. Legal holds: ${legalHolds}. Privacy reviews: ${privacyPending}.`,
        category: "SYSTEM",
        data: { retentionDue, legalHolds, privacyPending },
      },
      context: {
        trigger: "CUSTOM",
        placementHint: "admin-inbox",
      },
      priority: retentionDue > 0 || legalHolds > 0 ? "HIGH" : "NORMAL",
      idempotencyKey: `customer-lifecycle-review:${dayKey(context.now)}`,
      createdAt: context.now,
    }));
  }

  return {
    retentionDue,
    legalHoldsForReview: legalHolds,
    privacyReviews: privacyPending,
    automaticPurge: false,
    emailQueued: 0,
    notificationsQueued: !context.dryRun && reviewRequired ? 1 : 0,
    reviewSurface: "admin-notifications",
  };
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
  const failed = await db.webhookEvent.findMany({
    where: {
      status: "FAILED",
      resolutionStatus: "OPEN",
      lastErrorCode: {
        in: ["PAYMENT_PROCESSING_RETRYABLE", "PAYMENT_PROVIDER_UNAVAILABLE"],
      },
    },
    select: { id: true },
    orderBy: { receivedAt: "asc" },
    take: 20,
  });
  const reconciliationCandidates = await db.payment.count({
    where: {
      provider: "paymongo",
      status: { in: ["PENDING", "PAID", "REFUNDED"] },
      reconciliations: { none: {} },
    },
  });
  if (context.dryRun) {
    return {
      retryableWebhooks: failed.length,
      reconciliationCandidates,
      automaticSettlement: false,
      emailQueued: 0,
    };
  }

  let retried = 0;
  let failedRetries = 0;
  for (const webhook of failed) {
    try {
      await retryStoredWebhook(webhook.id);
      retried += 1;
    } catch {
      failedRetries += 1;
    }
  }

  const reviewRequired = failedRetries > 0 || reconciliationCandidates > 0;
  if (reviewRequired) {
    await db.$transaction((tx) => persistNotification(tx, {
      source: {
        moduleId: "payments",
        event: "PAYMENT_OPERATIONS_REVIEW",
      },
      audience: { kind: "ADMINISTRATORS" },
      content: {
        title: "Payment operations review required",
        body: `Failed retries: ${failedRetries}. Reconciliation candidates: ${reconciliationCandidates}.`,
        category: "SYSTEM",
        data: {
          retryableWebhooks: failed.length,
          retried,
          failedRetries,
          reconciliationCandidates,
        },
      },
      context: {
        trigger: "CUSTOM",
        placementHint: "admin-inbox",
      },
      priority: failedRetries > 0 ? "HIGH" : "NORMAL",
      idempotencyKey: `payment-operations-review:${dayKey(context.now)}`,
      createdAt: context.now,
    }));
  }

  return {
    retriedWebhooks: retried,
    failedRetries,
    reconciliationReminders: reconciliationCandidates,
    automaticSettlement: false,
    emailQueued: 0,
    notificationsQueued: reviewRequired ? 1 : 0,
    reviewSurface: "admin-notifications",
  };
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
