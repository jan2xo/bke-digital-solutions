import "server-only";

import { randomUUID } from "node:crypto";
import type {
  CatalogProductDeletionDependencies,
  CatalogProductDeletionEligibility,
  CatalogProductDeletionResources,
  CatalogProductDeletionSnapshot,
  CatalogStorageCleanupStatus,
} from "@bke/catalog/contracts/product-deletion-policy.contract";
import {
  CatalogProductDeletionDecisionError,
  evaluateCatalogProductDeletionEligibility,
  planCatalogProductDeletionFinalization,
  planCatalogProductDeletionRequest,
} from "@bke/catalog/logic/product-deletion-policy";
import { Prisma } from "@/v2/platform/host/generated/prisma/client";
import { db } from "@/v2/platform/host/db";
import { redact } from "@/v2/platform/host/security/redaction";
import { processStorageCleanupJob, storageCleanupIdempotencyKey } from "@/v2/apps/web/storage/cleanup";

export { CatalogProductDeletionDecisionError as ProductDeletionError };
export type ProductDeletionEligibility = CatalogProductDeletionEligibility;

type EligibilityClient = Pick<
  Prisma.TransactionClient,
  | "product"
  | "orderItem"
  | "order"
  | "payment"
  | "paymentAttempt"
  | "invoice"
  | "license"
  | "subscription"
  | "trialGrant"
  | "cartItem"
  | "productArtifact"
  | "licenseAssignment"
  | "deviceActivation"
  | "downloadGrant"
  | "licenseEvent"
  | "discountOffer"
  | "offerRedemption"
>;

const emptyDependencies = (): CatalogProductDeletionDependencies => ({
  carts: 0,
  orderItems: 0,
  orders: 0,
  invoices: 0,
  payments: 0,
  paymentAttempts: 0,
  subscriptions: 0,
  trials: 0,
  licenses: 0,
  assignments: 0,
  activations: 0,
  downloadGrants: 0,
  downloads: 0,
  licenseEvents: 0,
  offers: 0,
  offerRedemptions: 0,
});

const emptyResources = (): CatalogProductDeletionResources => ({
  editions: 0,
  purchasePlans: 0,
  versions: 0,
  artifacts: 0,
  prices: 0,
  policies: 0,
  tags: 0,
  images: 0,
  storageObjects: 0,
});

function catalogCleanupStatus(value: string): CatalogStorageCleanupStatus {
  switch (value) {
    case "PENDING":
    case "PROCESSING":
    case "RETRYING":
    case "SUCCEEDED":
    case "FAILED":
      return value;
    case "CANCELLED":
      throw new CatalogProductDeletionDecisionError("STORAGE_CLEANUP_PENDING");
    default:
      throw new Error("INVALID_STORAGE_CLEANUP_STATUS");
  }
}

async function snapshotWithClient(client: EligibilityClient, productId: string): Promise<CatalogProductDeletionSnapshot> {
  const product = await client.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      name: true,
      slug: true,
      archivedAt: true,
      deletionRequestedAt: true,
      imageKey: true,
      tags: true,
      editions: { select: { _count: { select: { purchasePlans: true } } } },
      _count: { select: { editions: true, versions: true, artifacts: true, prices: true, policies: true } },
    },
  });

  if (!product) {
    return {
      productExists: false,
      productId,
      productName: null,
      productSlug: null,
      isArchived: false,
      deletionRequested: false,
      blockingDependencies: emptyDependencies(),
      removableResources: emptyResources(),
    };
  }

  const orderItemRows = await client.orderItem.findMany({ where: { productId }, select: { orderId: true } });
  const licenseRows = await client.license.findMany({ where: { productId }, select: { id: true } });
  const artifacts = await client.productArtifact.findMany({ where: { productId }, select: { objectKey: true, downloadCount: true } });
  const carts = await client.cartItem.count({ where: { price: { productId } } });
  const subscriptions = await client.subscription.count({ where: { productId } });
  const trials = await client.trialGrant.count({ where: { productId } });
  const offers = await client.discountOffer.findMany({
    where: { OR: [{ productId }, { edition: { productId } }, { purchasePlan: { edition: { productId } } }] },
    select: { id: true },
  });
  const orderIds = [...new Set(orderItemRows.map((item) => item.orderId))];
  const licenseIds = licenseRows.map((license) => license.id);
  const orders = orderIds.length ? await client.order.count({ where: { id: { in: orderIds } } }) : 0;
  const invoices = orderIds.length ? await client.invoice.count({ where: { orderId: { in: orderIds } } }) : 0;
  const payments = orderIds.length ? await client.payment.count({ where: { orderId: { in: orderIds } } }) : 0;
  const paymentAttempts = orderIds.length ? await client.paymentAttempt.count({ where: { orderId: { in: orderIds } } }) : 0;
  const assignments = licenseIds.length ? await client.licenseAssignment.count({ where: { licenseId: { in: licenseIds } } }) : 0;
  const activations = licenseIds.length ? await client.deviceActivation.count({ where: { licenseId: { in: licenseIds } } }) : 0;
  const downloadGrants = await client.downloadGrant.count({
    where: { OR: [{ artifact: { productId } }, ...(licenseIds.length ? [{ licenseId: { in: licenseIds } }] : [])] },
  });
  const licenseEvents = licenseIds.length ? await client.licenseEvent.count({ where: { licenseId: { in: licenseIds } } }) : 0;
  const offerRedemptions = offers.length
    ? await client.offerRedemption.count({ where: { offerId: { in: offers.map((offer) => offer.id) } } })
    : 0;

  return {
    productExists: true,
    productId,
    productName: product.name,
    productSlug: product.slug,
    isArchived: product.archivedAt !== null,
    deletionRequested: product.deletionRequestedAt !== null,
    blockingDependencies: {
      carts,
      orderItems: orderItemRows.length,
      orders,
      invoices,
      payments,
      paymentAttempts,
      subscriptions,
      trials,
      licenses: licenseRows.length,
      assignments,
      activations,
      downloadGrants,
      downloads: artifacts.reduce((sum, artifact) => sum + artifact.downloadCount, 0),
      licenseEvents,
      offers: offers.length,
      offerRedemptions,
    },
    removableResources: {
      editions: product._count.editions,
      purchasePlans: product.editions.reduce((sum, edition) => sum + edition._count.purchasePlans, 0),
      versions: product._count.versions,
      artifacts: product._count.artifacts,
      prices: product._count.prices,
      policies: product._count.policies,
      tags: product.tags.length,
      images: product.imageKey ? 1 : 0,
      storageObjects: artifacts.length + (product.imageKey ? 1 : 0),
    },
  };
}

export async function evaluateProductDeletionEligibility(productId: string) {
  return evaluateCatalogProductDeletionEligibility(await snapshotWithClient(db, productId));
}

export async function requestProductDeletion(input: {
  productId: string;
  actorId: string;
  confirmationName: string;
}) {
  const correlationId = randomUUID();
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${input.productId} FOR UPDATE`;
    const snapshot = await snapshotWithClient(tx, input.productId);
    const product = await tx.product.findUnique({
      where: { id: input.productId },
      select: { imageKey: true, deletionRequestedAt: true },
    });
    const artifacts = await tx.productArtifact.findMany({
      where: { productId: input.productId },
      select: { id: true, objectKey: true },
    });
    const plan = planCatalogProductDeletionRequest({
      snapshot,
      confirmationName: input.confirmationName,
      existingDeletionRequestedAt: product?.deletionRequestedAt ?? null,
      now: new Date(),
    });

    await tx.product.update({ where: { id: input.productId }, data: plan.productUpdate });
    const jobs = [
      ...(product?.imageKey
        ? [{ type: "PRODUCT_DELETION" as const, targetType: "Product", targetId: input.productId, objectKey: product.imageKey, productId: input.productId }]
        : []),
      ...artifacts.map((artifact) => ({
        type: "PRODUCT_DELETION" as const,
        targetType: "ProductArtifact",
        targetId: artifact.id,
        objectKey: artifact.objectKey,
        productId: input.productId,
        artifactId: artifact.id,
      })),
    ];
    if (plan.queueStorageCleanup) {
      for (const job of jobs) {
        const idempotencyKey = storageCleanupIdempotencyKey(job.type, job.targetId, job.objectKey);
        await tx.storageCleanupJob.upsert({
          where: { idempotencyKey },
          update: {},
          create: { ...job, idempotencyKey, correlationId, createdByAdminId: input.actorId },
        });
      }
    }
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: plan.auditAction,
        targetType: "Product",
        targetId: input.productId,
        metadata: redact({
          productName: plan.eligibility.productName,
          productSlug: plan.eligibility.productSlug,
          queuedObjects: jobs.length,
          eligibility: {
            reason: plan.eligibility.reason,
            blockingDependencies: plan.eligibility.blockingDependencies,
          },
        }) as Prisma.InputJsonValue,
      },
    });
    return { eligibility: plan.eligibility, queuedJobs: jobs.length };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 30_000 });
}

export async function finalizeProductDeletion(input: { productId: string; actorId: string }) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${input.productId} FOR UPDATE`;
    const snapshot = await snapshotWithClient(tx, input.productId);
    const jobs = await tx.storageCleanupJob.findMany({ where: { productId: input.productId }, select: { status: true } });
    const plan = planCatalogProductDeletionFinalization({
      snapshot,
      cleanupStatuses: jobs.map((job) => catalogCleanupStatus(job.status)),
    });

    if (plan.deleteCatalogResources) {
      await tx.productArtifact.deleteMany({ where: { productId: input.productId } });
      await tx.productVersion.deleteMany({ where: { productId: input.productId } });
      await tx.purchasePlan.deleteMany({ where: { edition: { productId: input.productId } } });
      await tx.edition.deleteMany({ where: { productId: input.productId } });
      await tx.price.deleteMany({ where: { productId: input.productId } });
      await tx.licensePolicy.deleteMany({ where: { productId: input.productId } });
      await tx.product.delete({ where: { id: input.productId } });
    }
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: plan.auditAction,
        targetType: "Product",
        targetId: input.productId,
        metadata: { cleanupJobs: jobs.length },
      },
    });
    return plan.eligibility;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 30_000 });
}

export async function permanentlyDeleteProduct(input: {
  productId: string;
  actorId: string;
  confirmationName: string;
  deleteStorageObject?: (objectKey: string) => Promise<void>;
}) {
  await requestProductDeletion(input);
  const jobs = await db.storageCleanupJob.findMany({
    where: { productId: input.productId, status: { not: "SUCCEEDED" } },
    select: { id: true },
  });
  for (const job of jobs) await processStorageCleanupJob(job.id, input.deleteStorageObject);
  return finalizeProductDeletion({ productId: input.productId, actorId: input.actorId });
}
