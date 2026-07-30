import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";

const optionalAmount = z.number().int().min(100).max(2_000_000_000).optional();
export const editionPlanSchema = z.object({
  name: z.string().trim().min(2).max(100),
  slug: z.string().regex(/^[a-z0-9-]+$/).max(80),
  description: z.string().trim().max(2_000).optional(),
  features: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
  maxUsers: z.number().int().min(1).max(10_000),
  maxDevicesPerUser: z.number().int().min(1).max(100),
  updatePolicy: z.enum(["LIFETIME", "ACTIVE_TERM", "MAJOR_VERSION"]),
  active: z.boolean().default(true),
  plans: z.object({
    perpetual: z.object({ enabled: z.boolean(), amountMinor: optionalAmount }),
    monthly: z.object({ enabled: z.boolean(), amountMinor: optionalAmount }),
    annual: z.object({ enabled: z.boolean(), discountBps: z.number().int().min(0).max(1_000).optional() }),
  }).superRefine((plans, context) => {
    if (plans.perpetual.enabled && plans.perpetual.amountMinor === undefined) context.addIssue({ code: "custom", path: ["perpetual", "amountMinor"], message: "Perpetual price is required" });
    if (plans.monthly.enabled && plans.monthly.amountMinor === undefined) context.addIssue({ code: "custom", path: ["monthly", "amountMinor"], message: "Monthly price is required" });
    if (plans.annual.enabled && !plans.monthly.enabled) context.addIssue({ code: "custom", path: ["annual"], message: "Annual requires an enabled monthly plan" });
    if (plans.annual.enabled && plans.annual.discountBps === undefined) context.addIssue({ code: "custom", path: ["annual", "discountBps"], message: "Annual discount is required" });
    if (!plans.perpetual.enabled && !plans.monthly.enabled) context.addIssue({ code: "custom", path: [], message: "At least one purchase plan is required" });
  }),
});

export type EditionPlanInput = z.infer<typeof editionPlanSchema>;

export async function syncEditionPlans(tx: Prisma.TransactionClient, editionId: string, input: EditionPlanInput["plans"]) {
  const perpetual = await tx.purchasePlan.upsert({
    where: { editionId_type: { editionId, type: "PERPETUAL" } },
    create: { editionId, type: "PERPETUAL", amountMinor: input.perpetual.amountMinor ?? 100, renewalBehavior: "NONE", active: input.perpetual.enabled },
    update: { amountMinor: input.perpetual.amountMinor, annualDiscountBps: null, monthlySourcePlanId: null, renewalBehavior: "NONE", active: input.perpetual.enabled },
  });
  const monthly = await tx.purchasePlan.upsert({
    where: { editionId_type: { editionId, type: "MONTHLY" } },
    create: { editionId, type: "MONTHLY", amountMinor: input.monthly.amountMinor ?? 100, renewalBehavior: "CUSTOMER_AUTHORIZED", active: input.monthly.enabled },
    update: { amountMinor: input.monthly.amountMinor, annualDiscountBps: null, monthlySourcePlanId: null, renewalBehavior: "CUSTOMER_AUTHORIZED", active: input.monthly.enabled },
  });
  const annual = await tx.purchasePlan.upsert({
    where: { editionId_type: { editionId, type: "ANNUAL" } },
    create: { editionId, type: "ANNUAL", amountMinor: null, annualDiscountBps: input.annual.discountBps ?? 0, monthlySourcePlanId: monthly.id, renewalBehavior: "CUSTOMER_AUTHORIZED", active: input.annual.enabled },
    update: { amountMinor: null, annualDiscountBps: input.annual.discountBps ?? 0, monthlySourcePlanId: monthly.id, renewalBehavior: "CUSTOMER_AUTHORIZED", active: input.annual.enabled },
  });
  return { perpetual, monthly, annual };
}

export async function createEdition(tx: Prisma.TransactionClient, productId: string, input: EditionPlanInput) {
  const edition = await tx.edition.create({ data: {
    productId,
    name: input.name,
    slug: input.slug,
    description: input.description,
    features: input.features,
    maxUsers: input.maxUsers,
    maxDevicesPerUser: input.maxDevicesPerUser,
    updatePolicy: input.updatePolicy,
    active: input.active,
  } });
  await syncEditionPlans(tx, edition.id, input.plans);
  return edition;
}
