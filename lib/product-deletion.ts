import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { redact } from "@/lib/redaction";
import { deleteObject } from "@/lib/storage";

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
    public readonly code: "NOT_FOUND" | "PRODUCT_DELETE_BLOCKED" | "PRODUCT_STORAGE_CLEANUP_FAILED",
    public readonly eligibility?: ProductDeletionEligibility,
  ) {
    super(code);
  }
}

export async function permanentlyDeleteProduct(input: {
  productId: string;
  actorId: string;
  confirmationName: string;
  deleteStorageObject?: (objectKey: string) => Promise<void>;
}) {
  const removeObject = input.deleteStorageObject ?? deleteObject;
  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${input.productId} FOR UPDATE`;
      const eligibility = await evaluateWithClient(tx, input.productId);
      if (!eligibility.productExists) throw new ProductDeletionError("NOT_FOUND", eligibility);
      if (input.confirmationName !== eligibility.productName || !eligibility.canDelete) {
        throw new ProductDeletionError("PRODUCT_DELETE_BLOCKED", eligibility);
      }

      const [product, artifacts] = await Promise.all([
        tx.product.findUniqueOrThrow({ where: { id: input.productId }, select: { imageKey: true } }),
        tx.productArtifact.findMany({ where: { productId: input.productId }, select: { objectKey: true } }),
      ]);
      const objectKeys = [...new Set([product.imageKey, ...artifacts.map((artifact) => artifact.objectKey)].filter((key): key is string => Boolean(key)))];
      try {
        for (const objectKey of objectKeys) await removeObject(objectKey);
      } catch {
        throw new ProductDeletionError("PRODUCT_STORAGE_CLEANUP_FAILED", eligibility);
      }

      await tx.productArtifact.deleteMany({ where: { productId: input.productId } });
      await tx.productVersion.deleteMany({ where: { productId: input.productId } });
      await tx.purchasePlan.deleteMany({ where: { edition: { productId: input.productId } } });
      await tx.edition.deleteMany({ where: { productId: input.productId } });
      await tx.price.deleteMany({ where: { productId: input.productId } });
      await tx.licensePolicy.deleteMany({ where: { productId: input.productId } });
      await tx.product.delete({ where: { id: input.productId } });
      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          action: "PRODUCT_PERMANENTLY_DELETED",
          targetType: "Product",
          targetId: input.productId,
          metadata: redact({
            productName: eligibility.productName,
            productSlug: eligibility.productSlug,
            deletedResources: eligibility.removableResources,
            eligibility: { reason: eligibility.reason, blockingDependencies: eligibility.blockingDependencies },
          }) as Prisma.InputJsonValue,
        },
      });
      return eligibility;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 30_000 });
  } catch (error) {
    if (error instanceof ProductDeletionError) throw error;
    throw error;
  }
}
