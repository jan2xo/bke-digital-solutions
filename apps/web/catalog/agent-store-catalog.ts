import "server-only";

import {
  COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID,
  type CommercePurchasePlanPricingCapability,
} from "@bke/commerce/contracts/purchase-plan-pricing.contract";
import type { Prisma } from "@/platform/persistence/generated/prisma/client";

export type AgentStorePlan = Readonly<{
  purchasePlanId: string;
  type: "PERPETUAL" | "MONTHLY" | "ANNUAL";
  currency: string;
  amountMinor: number;
  billingType: "ONE_TIME" | "SUBSCRIPTION";
  intervalUnit: "MONTH" | "YEAR" | null;
  intervalCount: number | null;
  renewalBehavior: "NONE" | "CUSTOMER_AUTHORIZED";
  savingsMinor: number;
  effectiveMonthlyMinor: number | null;
}>;

export type AgentStoreEdition = Readonly<{
  editionId: string;
  slug: string;
  name: string;
  description: string | null;
  features: readonly string[];
  maxUsers: number;
  maxDevicesPerUser: number;
  updatePolicy: string;
  plans: readonly AgentStorePlan[];
}>;

export type AgentStoreProduct = Readonly<{
  productId: string;
  slug: string;
  displayName: string;
  summary: string;
  description: string;
  productType: string;
  executionType: "LAUNCHER_PLUGIN" | "STANDALONE" | null;
  editions: readonly AgentStoreEdition[];
}>;

const planRank = Object.freeze({
  PERPETUAL: 0,
  MONTHLY: 1,
  ANNUAL: 2,
} satisfies Record<"PERPETUAL" | "MONTHLY" | "ANNUAL", number>);

function stringFeatures(value: Prisma.JsonValue): readonly string[] {
  return Array.isArray(value)
    ? Object.freeze(value.filter((item): item is string => typeof item === "string"))
    : Object.freeze([]);
}

export async function readAgentStoreCatalog(
  tx: Prisma.TransactionClient,
  pricing: CommercePurchasePlanPricingCapability,
): Promise<readonly AgentStoreProduct[]> {
  const products = await tx.product.findMany({
    where: {
      active: true,
      publishedAt: { not: null },
      archivedAt: null,
      productId: { not: null },
    },
    orderBy: [{ featured: "desc" }, { name: "asc" }],
    select: {
      productId: true,
      slug: true,
      name: true,
      summary: true,
      description: true,
      type: true,
      launcherExecutionType: true,
      editions: {
        where: { active: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          features: true,
          maxUsers: true,
          maxDevicesPerUser: true,
          updatePolicy: true,
          purchasePlans: {
            where: { active: true },
            include: {
              monthlySource: {
                select: {
                  amountMinor: true,
                  active: true,
                  type: true,
                  editionId: true,
                },
              },
            },
          },
        },
      },
    },
  });

  return Object.freeze(products.flatMap((product) => {
    if (!product.productId) return [];

    const editions = product.editions.flatMap((edition) => {
      const plans = edition.purchasePlans
        .map((plan) => {
          const resolved = pricing.resolve(plan);
          if (resolved.status === "FAILED") {
            throw new Error(
              `STORE_PRICING_INVALID:${plan.id}:${resolved.code}`,
            );
          }

          return Object.freeze({
            purchasePlanId: plan.id,
            type: plan.type,
            currency: plan.currency,
            amountMinor: resolved.pricing.amountMinor,
            billingType: resolved.pricing.billingType,
            intervalUnit: resolved.pricing.intervalUnit,
            intervalCount: resolved.pricing.intervalCount,
            renewalBehavior: plan.renewalBehavior,
            savingsMinor: resolved.pricing.savingsMinor,
            effectiveMonthlyMinor: resolved.pricing.effectiveMonthlyMinor,
          }) satisfies AgentStorePlan;
        })
        .sort((left, right) => planRank[left.type] - planRank[right.type]);

      if (plans.length === 0) return [];

      return [Object.freeze({
        editionId: edition.id,
        slug: edition.slug,
        name: edition.name,
        description: edition.description,
        features: stringFeatures(edition.features),
        maxUsers: edition.maxUsers,
        maxDevicesPerUser: edition.maxDevicesPerUser,
        updatePolicy: edition.updatePolicy,
        plans: Object.freeze(plans),
      }) satisfies AgentStoreEdition];
    });

    if (editions.length === 0) return [];

    return [Object.freeze({
      productId: product.productId,
      slug: product.slug,
      displayName: product.name,
      summary: product.summary,
      description: product.description,
      productType: product.type,
      executionType: product.launcherExecutionType,
      editions: Object.freeze(editions),
    }) satisfies AgentStoreProduct];
  }));
}

export { COMMERCE_PURCHASE_PLAN_PRICING_CAPABILITY_ID };
