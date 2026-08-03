import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { redact } from "@/lib/redaction";
import { processStorageCleanupJob, storageCleanupIdempotencyKey } from "@/lib/storage-cleanup";

export type ProductDeletionDependencies = {
  carts: number;
  orderItems: number;
  orders: number;
  invoices: number;
  payments: number;
  paymentAttempts: number;
  subscriptions: number;
  trials: number;
  licenses: number;
  assignments: number;
  activations: number;
  downloadGrants: number;
  downloads: number;
  licenseEvents: number;
  offers: number;
  offerRedemptions: number;
};

export type ProductDeletionResources = {
  editions: number;
  purchasePlans: number;
  versions: number;
  artifacts: number;
  prices: number;
  policies: number;
  tags: number;
  images: number;
  storageObjects: number;
};

export type ProductDeletionEligibility = {
  productExists: boolean;
  productId: string;
  productName: string | null;
  productSlug: string | null;
  isArchived: boolean;
  canDelete: boolean;
  reason: "NOT_FOUND" | "PRODUCT_NOT_ARCHIVED" | "HISTORICAL_DEPENDENCIES" | "ELIGIBLE";
  blockingDependencies: ProductDeletionDependencies;
  removableResources: ProductDeletionResources;
};

type EligibilityClient = Pick<
  Prisma.TransactionClient,
  "product" | "orderItem" | "order" | "payment" | "paymentAttempt" | "invoice" | "license" | "subscription" | "trialGrant" | "cartItem" | "productArtifact" | "licenseAssignment" | "deviceActivation" | "downloadGrant" | "licenseEvent" | "discountOffer" | "offerRedemption"
>;

const emptyDependencies = (): ProductDeletionDependencies => ({
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

const emptyResources = (): ProductDeletionResources => ({
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

async function evaluateWithClient(client: EligibilityClient, productId: string): Promise<ProductDeletionEligibility> {
  const product = await client.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      name: true,
      slug: true,
      archivedAt: true,
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
      canDelete: false,
      reason: "NOT_FOUND",
      blockingDependencies: emptyDependencies(),
      removableResources: emptyResources(),
    };
  }

  const [orderItemRows, licenseRows, artifacts, carts, subscriptions, trials, offers] = await Promise.all([
    client.orderItem.findMany({ where: { productId }, select: { orderId: true } }),
    client.license.findMany({ where: { productId }, select: { id: true } }),
    client.productArtifact.findMany({ where: { productId }, select: { objectKey: true, downloadCount: true } }),
    client.cartItem.count({ where: { price: { productId } } }),
    client.subscription.count({ where: { productId } }),
    client.trialGrant.count({ where: { productId } }),
    client.discountOffer.findMany({ where: { OR: [{ productId }, { edition: { productId } }, { purchasePlan: { edition: { productId } } }] }, select: { id: true } }),
  ]);
  const orderIds = [...new Set(orderItemRows.map((item) => item.orderId))];
  const licenseIds = licenseRows.map((license) => license.id);
  const [orders, invoices, payments, paymentAttempts, assignments, activations, grants, licenseEvents, offerRedemptions] = await Promise.all([
    orderIds.length ? client.order.count({ where: { id: { in: orderIds } } }) : 0,
    orderIds.length ? client.invoice.count({ where: { orderId: { in: orderIds } } }) : 0,
    orderIds.length ? client.payment.count({ where: { orderId: { in: orderIds } } }) : 0,
    orderIds.length ? client.paymentAttempt.count({ where: { orderId: { in: orderIds } } }) : 0,
    licenseIds.length ? client.licenseAssignment.count({ where: { licenseId: { in: licenseIds } } }) : 0,
    licenseIds.length ? client.deviceActivation.count({ where: { licenseId: { in: licenseIds } } }) : 0,
    client.downloadGrant.count({ where: { OR: [{ artifact: { productId } }, ...(licenseIds.length ? [{ licenseId: { in: licenseIds } }] : [])] } }),
    licenseIds.length ? client.licenseEvent.count({ where: { licenseId: { in: licenseIds } } }) : 0,
    offers.length ? client.offerRedemption.count({ where: { offerId: { in: offers.map((offer) => offer.id) } } }) : 0,
  ]);
  const recordedDownloads = artifacts.reduce((sum, artifact) => sum + artifact.downloadCount, 0);
  const blockingDependencies: ProductDeletionDependencies = {
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
    downloadGrants: grants,
    downloads: recordedDownloads,
    licenseEvents,
    offers: offers.length,
    offerRedemptions,
  };
  const removableResources: ProductDeletionResources = {
    editions: product._count.editions,
    purchasePlans: product.editions.reduce((sum, edition) => sum + edition._count.purchasePlans, 0),
    versions: product._count.versions,
    artifacts: product._count.artifacts,
    prices: product._count.prices,
    policies: product._count.policies,
    tags: product.tags.length,
    images: product.imageKey ? 1 : 0,
    storageObjects: artifacts.length + (product.imageKey ? 1 : 0),
  };
  const hasBlockers = Object.values(blockingDependencies).some((count) => count > 0);
  const isArchived = product.archivedAt !== null;
  return {
    productExists: true,
    productId,
    productName: product.name,
    productSlug: product.slug,
    isArchived,
    canDelete: isArchived && !hasBlockers,
    reason: !isArchived ? "PRODUCT_NOT_ARCHIVED" : hasBlockers ? "HISTORICAL_DEPENDENCIES" : "ELIGIBLE",
    blockingDependencies,
    removableResources,
  };
}

export function evaluateProductDeletionEligibility(productId: string) {
  return evaluateWithClient(db, productId);
}

export class ProductDeletionError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "PRODUCT_DELETE_BLOCKED" | "STORAGE_CLEANUP_PENDING" | "STORAGE_CLEANUP_FAILED" | "PRODUCT_DELETION_NOT_READY",
    public readonly eligibility?: ProductDeletionEligibility,
  ) {
    super(code);
  }
}

export async function requestProductDeletion(input: {
  productId: string;
  actorId: string;
  confirmationName: string;
}) {
  const correlationId = randomUUID();
  return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${input.productId} FOR UPDATE`;
      const eligibility = await evaluateWithClient(tx, input.productId);
      if (!eligibility.productExists) throw new ProductDeletionError("NOT_FOUND", eligibility);
      if (input.confirmationName !== eligibility.productName || !eligibility.canDelete) {
        throw new ProductDeletionError("PRODUCT_DELETE_BLOCKED", eligibility);
      }

      const [product, artifacts] = await Promise.all([
        tx.product.findUniqueOrThrow({ where: { id: input.productId }, select: { imageKey: true, deletionRequestedAt: true } }),
        tx.productArtifact.findMany({ where: { productId: input.productId }, select: { id: true, objectKey: true } }),
      ]);
      const now = product.deletionRequestedAt ?? new Date();
      await tx.product.update({ where: { id: input.productId }, data: { deletionRequestedAt: now, active: false } });
      const jobs = [
        ...(product.imageKey ? [{ type: "PRODUCT_DELETION" as const, targetType: "Product", targetId: input.productId, objectKey: product.imageKey, productId: input.productId }] : []),
        ...artifacts.map((artifact) => ({ type: "PRODUCT_DELETION" as const, targetType: "ProductArtifact", targetId: artifact.id, objectKey: artifact.objectKey, productId: input.productId, artifactId: artifact.id })),
      ];
      for (const job of jobs) {
        const idempotencyKey = storageCleanupIdempotencyKey(job.type, job.targetId, job.objectKey);
        await tx.storageCleanupJob.upsert({ where: { idempotencyKey }, update: {}, create: { ...job, idempotencyKey, correlationId, createdByAdminId: input.actorId } });
      }
      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          action: "PRODUCT_DELETION_REQUESTED",
          targetType: "Product",
          targetId: input.productId,
          metadata: redact({
            productName: eligibility.productName,
            productSlug: eligibility.productSlug,
            queuedObjects: jobs.length,
            eligibility: { reason: eligibility.reason, blockingDependencies: eligibility.blockingDependencies },
          }) as Prisma.InputJsonValue,
        },
      });
      return { eligibility, queuedJobs: jobs.length };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 30_000 });
}

export async function finalizeProductDeletion(input: { productId: string; actorId: string }) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${input.productId} FOR UPDATE`;
    const product = await tx.product.findUnique({ where: { id: input.productId }, select: { deletionRequestedAt: true } });
    if (!product) throw new ProductDeletionError("NOT_FOUND");
    if (!product.deletionRequestedAt) throw new ProductDeletionError("PRODUCT_DELETION_NOT_READY");
    const jobs = await tx.storageCleanupJob.findMany({ where: { productId: input.productId }, select: { status: true } });
    if (jobs.some((job) => job.status === "FAILED")) throw new ProductDeletionError("STORAGE_CLEANUP_FAILED");
    if (jobs.some((job) => job.status !== "SUCCEEDED")) throw new ProductDeletionError("STORAGE_CLEANUP_PENDING");
    const eligibility = await evaluateWithClient(tx, input.productId);
    if (!eligibility.canDelete) throw new ProductDeletionError("PRODUCT_DELETE_BLOCKED", eligibility);
    await tx.productArtifact.deleteMany({ where: { productId: input.productId } });
    await tx.productVersion.deleteMany({ where: { productId: input.productId } });
    await tx.purchasePlan.deleteMany({ where: { edition: { productId: input.productId } } });
    await tx.edition.deleteMany({ where: { productId: input.productId } });
    await tx.price.deleteMany({ where: { productId: input.productId } });
    await tx.licensePolicy.deleteMany({ where: { productId: input.productId } });
    await tx.product.delete({ where: { id: input.productId } });
    await tx.auditLog.create({ data: { actorId: input.actorId, action: "PRODUCT_DELETION_FINALIZED", targetType: "Product", targetId: input.productId, metadata: { cleanupJobs: jobs.length } } });
    return eligibility;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 30_000 });
}

// Operational helper: each storage operation occurs after the request transaction commits.
export async function permanentlyDeleteProduct(input: { productId: string; actorId: string; confirmationName: string; deleteStorageObject?: (objectKey: string) => Promise<void> }) {
  await requestProductDeletion(input);
  const jobs = await db.storageCleanupJob.findMany({ where: { productId: input.productId, status: { not: "SUCCEEDED" } }, select: { id: true } });
  for (const job of jobs) await processStorageCleanupJob(job.id, input.deleteStorageObject);
  return finalizeProductDeletion({ productId: input.productId, actorId: input.actorId });
}
