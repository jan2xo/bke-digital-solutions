import { z } from "zod";

/** Stable external software/licensing identity; distinct from DB id and catalog slug. */
export const productIdSchema = z.string().trim().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/).max(80);

export function assertProductIdChangeAllowed(input: {
  existingProductId: string | null;
  requestedProductId: string;
  lifecycleLocked: boolean;
}) {
  if (input.existingProductId && input.existingProductId !== input.requestedProductId && input.lifecycleLocked) {
    throw new Error("PRODUCT_ID_IMMUTABLE");
  }
}
