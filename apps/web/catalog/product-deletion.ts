import "server-only";

import type {
  CatalogProductDeletionDependencies,
  CatalogProductDeletionEligibility,
  CatalogProductDeletionResources,
  CatalogProductDeletionSnapshot,
} from "@bke/catalog/contracts/product-deletion-policy.contract";
import {
  CatalogProductDeletionDecisionError,
  evaluateCatalogProductDeletionEligibility,
  planCatalogProductDeletionFinalization,
  planCatalogProductDeletionRequest,
} from "@bke/catalog/logic/product-deletion-policy";
import { Prisma } from "@/platform/persistence/generated/prisma/client";
import { db } from "@/platform/host/db";
import { redact } from "@/platform/host/security/redaction";

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
  | "licenseAssignment"
  | "deviceActivation"
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
      _count: { select: { editions: true, versions: true, prices: true, policies: true } },
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
      downloadGrants: 0,
      downloads: 0,
      licenseEvents,
      offers: offers.length,
      offerRedemptions,
    },
    removableResources: {
      editions: product._count.editions,
      purchasePlans: product.editions.reduce((sum, edition) => sum + edition._count.purchasePlans, 0),
      versions: product._count.versions,
      artifacts: 0,
      prices: product._count.prices,
      policies: product._count.policies,
      tags: product.tags.length,
      images: product.imageKey ? 1 : 0,
      storageObjects: 0,
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
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${input.productId} FOR UPDATE`;
    const snapshot = await snapshotWithClient(tx, input.productId);
    const product = await tx.product.findUnique({
      where: { id: input.productId },
      select: { deletionRequestedAt: true },
    });
    const plan = planCatalogProductDeletionRequest({
      snapshot,
      confirmationName: input.confirmationName,
      existingDeletionRequestedAt: product?.deletionRequestedAt ?? null,
      now: new Date(),
    });

    await tx.product.update({ where: { id: input.productId }, data: plan.productUpdate });
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: plan.auditAction,
        targetType: "Product",
        targetId: input.productId,
        metadata: redact({
          productName: plan.eligibility.productName,
          productSlug: plan.eligibility.productSlug,
          queuedObjects: 0,
          eligibility: {
            reason: plan.eligibility.reason,
            blockingDependencies: plan.eligibility.blockingDependencies,
          },
        }) as Prisma.InputJsonValue,
      },
    });
    return { eligibility: plan.eligibility, queuedJobs: 0 };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 30_000 });
}

export async function finalizeProductDeletion(input: { productId: string; actorId: string }) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${input.productId} FOR UPDATE`;
    const snapshot = await snapshotWithClient(tx, input.productId);
    const plan = planCatalogProductDeletionFinalization({
      snapshot,
      cleanupStatuses: [],
    });

    if (plan.deleteCatalogResources) {
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
        metadata: { cleanupJobs: 0 },
      },
    });
    return plan.eligibility;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 30_000 });
}

export async function permanentlyDeleteProduct(input: {
  productId: string;
  actorId: string;
  confirmationName: string;
}) {
  await requestProductDeletion(input);
  return finalizeProductDeletion({ productId: input.productId, actorId: input.actorId });
}
