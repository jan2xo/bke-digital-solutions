import { z } from "zod";
import {
  assertCatalogProductIdChangeAllowed,
  isCatalogProductId,
  normalizeCatalogProductId,
} from "@bke/catalog/logic/product-identity-policy";
import {
  validateAcceptedVersionRange as validateLicensingAcceptedVersionRange,
} from "@bke/licensing/logic/accepted-version-policy";

export const productIdSchema = z
  .string()
  .trim()
  .refine(isCatalogProductId, "Invalid product ID")
  .transform(normalizeCatalogProductId);

export const acceptedVersionSchema = z
  .string()
  .trim()
  .refine((value) => {
    try {
      validateLicensingAcceptedVersionRange(value, null);
      return true;
    } catch {
      return false;
    }
  }, "Invalid semantic version");

export const validateAcceptedVersionRange = validateLicensingAcceptedVersionRange;
export const assertProductIdChangeAllowed = assertCatalogProductIdChangeAllowed;
