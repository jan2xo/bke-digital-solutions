import { z } from "zod";

export const checkoutSchema = z
  .object({
    purchasePlanId: z.string().cuid(),
    customerAccountId: z.string().cuid(),
    offerIdentifier: z.string().trim().min(1).max(100).optional(),
    legalVersionIds: z.array(z.string().cuid()).min(2).max(3),
  })
  .strict();
