import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";

const optionalAmount = z.number().int().min(100).max(2_000_000_000).optional();
const planSchema = z.object({ enabled: z.boolean(), amountMinor: optionalAmount, listAmountMinor: optionalAmount }).superRefine((plan, context) => {
  if (plan.enabled && plan.amountMinor === undefined) context.addIssue({ code: "custom", path: ["amountMinor"], message: "Selling price is required" });
  if (plan.enabled && plan.listAmountMinor === undefined) context.addIssue({ code: "custom", path: ["listAmountMinor"], message: "List price is required" });
  if (plan.enabled && plan.amountMinor !== undefined && plan.listAmountMinor !== undefined && plan.listAmountMinor < plan.amountMinor) context.addIssue({ code: "custom", path: ["listAmountMinor"], message: "List price must be greater than or equal to selling price" });
});

export const editionPlanSchema = z.object({
  name: z.string().trim().min(2).max(100),
  slug: z.string().regex(/^[a-z0-9-]+$/).max(80),
  description: z.string().trim().max(2_000).optional(),
  features: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
  maxUsers: z.number().int().min(1).max(10_000),
  maxDevicesPerUser: z.number().int().min(1).max(100),
  updatePolicy: z.enum(["LIFETIME", "ACTIVE_TERM", "MAJOR_VERSION"]),
  active: z.boolean().default(true),
  plans: z.object({ perpetual: planSchema, monthly: planSchema, annual: planSchema }).superRefine((plans, context) => {
    if (!plans.perpetual.enabled && !plans.monthly.enabled && !plans.annual.enabled) context.addIssue({ code: "custom", path: [], message: "At least one purchase plan is required" });
  }),
});

export type EditionPlanInput = z.infer<typeof editionPlanSchema>;

export async function syncEditionPlans(tx: Prisma.TransactionClient, editionId: string, input: EditionPlanInput["plans"]) {
  const upsert = (type: "PERPETUAL" | "MONTHLY" | "ANNUAL", plan: { enabled: boolean; amountMinor?: number; listAmountMinor?: number }) => tx.purchasePlan.upsert({
    where: { editionId_type: { editionId, type } },
    create: { editionId, type, amountMinor: plan.amountMinor ?? 100, listAmountMinor: plan.listAmountMinor ?? plan.amountMinor ?? 100, annualDiscountBps: null, monthlySourcePlanId: null, renewalBehavior: type === "PERPETUAL" ? "NONE" : "CUSTOMER_AUTHORIZED", active: plan.enabled },
    update: { amountMinor: plan.amountMinor, listAmountMinor: plan.listAmountMinor, annualDiscountBps: null, monthlySourcePlanId: null, renewalBehavior: type === "PERPETUAL" ? "NONE" : "CUSTOMER_AUTHORIZED", active: plan.enabled },
  });
  const perpetual = await upsert("PERPETUAL", input.perpetual);
  const monthly = await upsert("MONTHLY", input.monthly);
  const annual = await upsert("ANNUAL", input.annual);
  return { perpetual, monthly, annual };
}

export async function createEdition(tx: Prisma.TransactionClient, productId: string, input: EditionPlanInput) {
  const edition = await tx.edition.create({ data: { productId, name: input.name, slug: input.slug, description: input.description, features: input.features, maxUsers: input.maxUsers, maxDevicesPerUser: input.maxDevicesPerUser, updatePolicy: input.updatePolicy, active: input.active } });
  await syncEditionPlans(tx, edition.id, input.plans);
  return edition;
}
