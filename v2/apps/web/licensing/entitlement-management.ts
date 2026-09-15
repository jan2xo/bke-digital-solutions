import "server-only";

import { randomUUID } from "node:crypto";
import {
  createLicensingEntitlementManagementCapability,
  licensingInitialExpiration,
  licensingRenewalExpiration,
  type LicensingEntitlementManagementRepository,
} from "@bke/licensing/logic/entitlement-management";
import { PaymentLifecycleError } from "@bke/payments/logic/payment-errors";
import type { Prisma } from "@/v2/platform/persistence/generated/prisma/client";
import {
  encryptLicenseKey,
  generateLicenseKey,
  hashLicenseKey,
} from "@/v2/platform/host/security/crypto";

export type RenewalLeaseRequest = Readonly<{
  operationId: string;
  licenseId: string;
  deviceHash: string;
}>;

type PaymentEvidence = Readonly<{
  paymentId?: string;
  paymentEventId?: string;
}>;

type LicensingIssueRepositoryInput = Parameters<LicensingEntitlementManagementRepository["issue"]>[0];
type LicensingRenewRepositoryInput = Parameters<LicensingEntitlementManagementRepository["renewSubscription"]>[0];

function addDays(value: Date, count: number): Date {
  return new Date(value.getTime() + count * 86_400_000);
}

function addBillingInterval(value: Date, unit: "MONTH" | "YEAR", count: number): Date {
  const next = new Date(value.getTime());
  if (unit === "YEAR") next.setUTCFullYear(next.getUTCFullYear() + count);
  else next.setUTCMonth(next.getUTCMonth() + count);
  return next;
}

function createRepository(tx: Prisma.TransactionClient): LicensingEntitlementManagementRepository {
  return Object.freeze({
    async issue(input: LicensingIssueRepositoryInput) {
      const license = await tx.license.create({
        data: {
          publicId: input.publicId,
          keyHash: input.keyHash,
          keyLastFour: input.keyLastFour,
          keyCiphertext: input.keyCiphertext,
          accountId: input.accountId,
          orderId: input.orderId,
          orderItemId: input.orderItemId,
          productId: input.productId,
          editionId: input.editionId,
          purchasePlanId: input.purchasePlanId,
          subscriptionId: input.subscriptionId,
          maxSeats: input.maxSeats,
          maxDevicesPerSeat: input.maxDevicesPerSeat,
          expiresAt: input.expiresAt,
          events: {
            create: {
              type: "ISSUED",
              metadata: input.eventMetadata as Prisma.InputJsonValue,
            },
          },
        },
        select: { id: true, publicId: true, subscriptionId: true, expiresAt: true },
      });
      return Object.freeze({
        id: license.id,
        publicId: license.publicId,
        subscriptionId: license.subscriptionId,
        status: "ACTIVE" as const,
        expiresAt: license.expiresAt,
      });
    },

    async renewSubscription(input: LicensingRenewRepositoryInput) {
      const durationMs = input.periodEnd.getTime() - input.periodStart.getTime();
      const licenses = await tx.license.findMany({
        where: { subscriptionId: input.subscriptionId },
        select: {
          id: true,
          publicId: true,
          expiresAt: true,
          activations: {
            where: { active: true },
            select: { deviceHash: true },
          },
        },
      });

      const snapshots = [];
      const renewalOperations = [];
      for (const license of licenses) {
        const effectiveExpiry = licensingRenewalExpiration(
          license.expiresAt,
          input.effectiveAt,
          durationMs,
        );
        await tx.license.update({
          where: { id: license.id },
          data: { status: "ACTIVE", expiresAt: effectiveExpiry },
        });

        const operationBase = `renewal:${input.orderId}:${license.id}`;
        if (license.activations.length > 0) {
          for (const activation of license.activations) {
            const operationId = `${operationBase}:${activation.deviceHash}`;
            await tx.commercialLeaseOperation.upsert({
              where: { operationId },
              create: {
                operationId,
                licenseId: license.id,
                action: "RENEWAL",
                status: "PREPARED",
                metadata: {
                  orderId: input.orderId,
                  paymentId: input.paymentId,
                  paymentEventId: input.paymentEventId,
                  oldExpiry: license.expiresAt?.toISOString() ?? null,
                  newExpiry: effectiveExpiry.toISOString(),
                  durationMs,
                  decision: "SUCCESSOR_LEASE_PENDING",
                  deviceHash: activation.deviceHash,
                },
              },
              update: {},
            });
            renewalOperations.push(Object.freeze({
              operationId,
              licenseId: license.id,
              deviceHash: activation.deviceHash,
              status: "PREPARED" as const,
              effectiveExpiry,
            }));
          }
        } else {
          const operationId = `${operationBase}:none`;
          await tx.commercialLeaseOperation.upsert({
            where: { operationId },
            create: {
              operationId,
              licenseId: license.id,
              action: "RENEWAL",
              status: "COMPLETED",
              metadata: {
                orderId: input.orderId,
                paymentId: input.paymentId,
                paymentEventId: input.paymentEventId,
                oldExpiry: license.expiresAt?.toISOString() ?? null,
                newExpiry: effectiveExpiry.toISOString(),
                durationMs,
                decision: "ENTITLEMENT_RENEWED_NO_ACTIVE_INSTALLATION",
              },
              completedAt: input.effectiveAt,
            },
            update: {},
          });
          renewalOperations.push(Object.freeze({
            operationId,
            licenseId: license.id,
            deviceHash: null,
            status: "COMPLETED" as const,
            effectiveExpiry,
          }));
        }

        await tx.licenseEvent.create({
          data: {
            licenseId: license.id,
            type: "RENEWED",
            metadata: {
              orderId: input.orderId,
              discountedCycle: input.discountedCycleConsumed,
              renewalOperationId: operationBase,
              oldExpiry: license.expiresAt?.toISOString() ?? null,
              newExpiry: effectiveExpiry.toISOString(),
            },
          },
        });
        snapshots.push(Object.freeze({
          id: license.id,
          publicId: license.publicId,
          subscriptionId: input.subscriptionId,
          status: "ACTIVE" as const,
          expiresAt: effectiveExpiry,
        }));
      }

      return Object.freeze({
        licenses: Object.freeze(snapshots),
        renewalOperations: Object.freeze(renewalOperations),
      });
    },
  });
}

export async function fulfillOrderLicensing(
  tx: Prisma.TransactionClient,
  orderId: string,
  evidence: PaymentEvidence,
  renewalRequests: RenewalLeaseRequest[],
) {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: true },
  });
  const capability = createLicensingEntitlementManagementCapability(createRepository(tx));
  const effectiveAt = new Date();

  for (const item of order.items) {
    const policy = item.policySnapshot as {
      maxSeats: number;
      maxDevicesPerSeat: number;
      validityDays?: number;
    };
    let subscriptionId: string | null = null;
    let expiresAt = licensingInitialExpiration(effectiveAt, policy.validityDays);

    if (item.billingType === "SUBSCRIPTION") {
      let intervalUnit = item.intervalUnit;
      let intervalCount = item.intervalCount ?? 1;
      if (!intervalUnit) {
        const legacyPrice = await tx.price.findUniqueOrThrow({ where: { id: item.priceId } });
        intervalUnit = legacyPrice.intervalUnit;
        intervalCount = legacyPrice.intervalCount ?? 1;
      }
      if (intervalUnit !== "MONTH" && intervalUnit !== "YEAR") {
        throw new PaymentLifecycleError("PAYMENT_PROCESSING_FAILED");
      }

      const existing = order.renewalSubscriptionId
        ? await tx.subscription.findUniqueOrThrow({ where: { id: order.renewalSubscriptionId } })
        : null;
      const periodStart = existing?.currentPeriodEnd && existing.currentPeriodEnd > effectiveAt
        ? existing.currentPeriodEnd
        : effectiveAt;
      const periodEnd = addBillingInterval(periodStart, intervalUnit, intervalCount);

      if (existing) {
        const consumeDiscount = Boolean(
          item.offerId
          && existing.discountedCyclesTotal
          && existing.discountedCyclesConsumed < existing.discountedCyclesTotal,
        );
        await tx.subscription.update({
          where: { id: existing.id },
          data: {
            status: "ACTIVE",
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            renewalReminderAt: addDays(periodEnd, intervalUnit === "MONTH" ? -7 : -30),
            discountedCyclesConsumed: consumeDiscount ? { increment: 1 } : undefined,
          },
        });
        const renewal = await capability.renewSubscription({
          subscriptionId: existing.id,
          orderId,
          periodStart,
          periodEnd,
          effectiveAt,
          discountedCycleConsumed: consumeDiscount,
          paymentId: evidence.paymentId,
          paymentEventId: evidence.paymentEventId,
        });
        if (renewal.status !== "OK") {
          throw new PaymentLifecycleError("PAYMENT_PROCESSING_RETRYABLE", true);
        }
        for (const operation of renewal.renewalOperations) {
          if (operation.status === "PREPARED" && operation.deviceHash) {
            renewalRequests.push(Object.freeze({
              operationId: operation.operationId,
              licenseId: operation.licenseId,
              deviceHash: operation.deviceHash,
            }));
          }
        }
        continue;
      }

      const pricing = (item.pricingSnapshot ?? {}) as {
        catalogAmountMinor?: number;
        finalAmountMinor?: number;
        offer?: {
          discountBps?: number;
          discountedBillingCycles?: number;
        };
      };
      const subscription = await tx.subscription.create({
        data: {
          accountId: order.accountId,
          orderId,
          productId: item.productId,
          editionId: item.editionId,
          purchasePlanId: item.purchasePlanId,
          status: "ACTIVE",
          seats: item.quantity * policy.maxSeats,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          renewalReminderAt: addDays(periodEnd, intervalUnit === "MONTH" ? -7 : -30),
          currency: order.currency,
          normalRecurringAmountMinor: pricing.catalogAmountMinor ?? item.unitAmountMinor,
          discountedRecurringAmountMinor: pricing.offer ? pricing.finalAmountMinor : null,
          promotionalDiscountBps: pricing.offer?.discountBps,
          discountedCyclesTotal: pricing.offer?.discountedBillingCycles,
          discountedCyclesConsumed: pricing.offer?.discountedBillingCycles ? 1 : 0,
          offerId: item.offerId,
          offerSnapshot: pricing.offer as Prisma.InputJsonValue | undefined,
          pricingVersion: item.pricingVersion,
        },
      });
      subscriptionId = subscription.id;
      expiresAt = periodEnd;
    }

    const plaintextKey = generateLicenseKey();
    const issued = await capability.issue({
      keyMaterial: {
        publicId: randomUUID(),
        keyHash: hashLicenseKey(plaintextKey),
        keyLastFour: plaintextKey.slice(-4),
        keyCiphertext: encryptLicenseKey(plaintextKey),
      },
      accountId: order.accountId,
      orderId,
      orderItemId: item.id,
      productId: item.productId,
      editionId: item.editionId,
      purchasePlanId: item.purchasePlanId,
      subscriptionId,
      maxSeats: item.quantity * policy.maxSeats,
      maxDevicesPerSeat: policy.maxDevicesPerSeat,
      expiresAt,
      eventMetadata: {
        orderId,
        editionId: item.editionId,
        purchasePlanId: item.purchasePlanId,
        planType: item.planType,
      },
    });
    if (issued.status !== "OK") {
      throw new PaymentLifecycleError("PAYMENT_PROCESSING_RETRYABLE", true);
    }
  }
}
