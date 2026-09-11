import { z } from "zod";
import {
  assertCatalogProductIdChangeAllowed,
  isCatalogProductId,
} from "@bke/catalog/logic/product-identity-policy";
import {
  isVersionAccepted,
  validateAcceptedVersionRange,
} from "@bke/licensing/logic/accepted-version-policy";

export const productIdSchema = z.string().trim().max(80).refine(isCatalogProductId, "Invalid product ID");

export const acceptedVersionSchema = z.string().trim().refine((value) => {
  try {
    validateAcceptedVersionRange(value, null);
    return true;
  } catch {
    return false;
  }
}, "Invalid semantic version");

export { isVersionAccepted, validateAcceptedVersionRange };

export function assertProductIdChangeAllowed(input: {
  existingProductId: string | null;
  requestedProductId: string;
  lifecycleLocked: boolean;
}) {
  assertCatalogProductIdChangeAllowed(input);
}
