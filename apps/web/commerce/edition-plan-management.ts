import "server-only";
import { z } from "zod";
import type {
  CommerceEditionPlanInput,
  CommerceEditionPlanRepository,
  CommerceEditionPlanValidationReason,
} from "@bke/commerce/contracts/edition-plan-management.contract";
import {
  CommerceEditionPlanValidationError,
  createCommerceEdition,
  normalizeCommerceEditionPlanInput,
  synchronizeCommerceEditionPlans,
} from "@bke/commerce/logic/edition-plan-management";
import type { Prisma } from "@/platform/persistence/generated/prisma/client";

export const editionPlanInputSchema = z.object({
  name: z.string(),
  slug: z.string(),
  description: z.string().optional(),
  features: z.array(z.string()).optional(),
  maxUsers: z.number(),
  maxDevicesPerUser: z.number(),
  updatePolicy: z.enum(["LIFETIME", "ACTIVE_TERM", "MAJOR_VERSION"]),
  active: z.boolean().optional(),
  plans: z.object({
    perpetual: z.object({ enabled: z.boolean(), amountMinor: z.number().optional() }),
    monthly: z.object({ enabled: z.boolean(), amountMinor: z.number().optional() }),
    annual: z.object({ enabled: z.boolean(), discountBps: z.number().optional() }),
  }).strict(),
}).strict();

export type EditionPlanHttpInput = z.infer<typeof editionPlanInputSchema>;

export function editionPlanValidationMessage(reason: CommerceEditionPlanValidationReason): string {
  switch (reason) {
    case "PURCHASE_PLAN_REQUIRED": return "At least one purchase plan is required";
    case "ANNUAL_REQUIRES_MONTHLY": return "Annual requires an enabled monthly plan";
    case "ANNUAL_DISCOUNT_REQUIRED": return "Annual discount is required";
    case "PERPETUAL_PRICE_REQUIRED": return "Perpetual price is required";
    case "MONTHLY_PRICE_REQUIRED": return "Monthly price is required";
    case "NAME": return "Edition name is invalid";
    case "SLUG": return "Edition slug is invalid";
    case "DESCRIPTION": return "Edition description is invalid";
    case "FEATURE_COUNT": return "Too many edition features";
    case "FEATURE": return "Edition feature is invalid";
    case "MAX_USERS": return "Maximum users is invalid";
    case "MAX_DEVICES_PER_USER": return "Maximum devices per user is invalid";
    case "UPDATE_POLICY": return "Update policy is invalid";
    case "PERPETUAL_AMOUNT": return "Perpetual price is invalid";
    case "MONTHLY_AMOUNT": return "Monthly price is invalid";
    case "ANNUAL_DISCOUNT": return "Annual discount is invalid";
  }
}

function presentEditionPlanError(error: unknown): never {
  if (error instanceof CommerceEditionPlanValidationError) {
    throw new Error(editionPlanValidationMessage(error.reason));
  }
  throw error;
}

export function normalizeEditionPlanForHost(input: CommerceEditionPlanInput) {
  try {
    return normalizeCommerceEditionPlanInput(input);
  } catch (error) {
    return presentEditionPlanError(error);
  }
}

export function createEditionPlanRepository(tx: Prisma.TransactionClient): CommerceEditionPlanRepository {
  return {
    async createEdition(input) {
      return tx.edition.create({
        data: {
          productId: input.productId,
          name: input.name,
          slug: input.slug,
          description: input.description,
          features: [...input.features],
          maxUsers: input.maxUsers,
          maxDevicesPerUser: input.maxDevicesPerUser,
          updatePolicy: input.updatePolicy,
          active: input.active,
        },
      });
    },
    async upsertPurchasePlan(input) {
      const updateAmount = Object.prototype.hasOwnProperty.call(input, "updateAmountMinor")
        ? { amountMinor: input.updateAmountMinor }
        : {};
      return tx.purchasePlan.upsert({
        where: { editionId_type: { editionId: input.editionId, type: input.type } },
        create: {
          editionId: input.editionId,
          type: input.type,
          amountMinor: input.createAmountMinor,
          annualDiscountBps: input.annualDiscountBps,
          monthlySourcePlanId: input.monthlySourcePlanId,
          renewalBehavior: input.renewalBehavior,
          active: input.active,
        },
        update: {
          ...updateAmount,
          annualDiscountBps: input.annualDiscountBps,
          monthlySourcePlanId: input.monthlySourcePlanId,
          renewalBehavior: input.renewalBehavior,
          active: input.active,
        },
      });
    },
  };
}

export async function createEditionWithCommerce(
  tx: Prisma.TransactionClient,
  productId: string,
  input: CommerceEditionPlanInput,
) {
  try {
    return await createCommerceEdition(createEditionPlanRepository(tx), productId, input);
  } catch (error) {
    return presentEditionPlanError(error);
  }
}

export async function synchronizeEditionPlansWithCommerce(
  tx: Prisma.TransactionClient,
  editionId: string,
  input: CommerceEditionPlanInput["plans"],
) {
  try {
    return await synchronizeCommerceEditionPlans(createEditionPlanRepository(tx), editionId, input);
  } catch (error) {
    return presentEditionPlanError(error);
  }
}
