import { z } from "zod";
import semver from "semver";

/** Stable external software/licensing identity; distinct from DB id and catalog slug. */
export const productIdSchema = z.string().trim().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/).max(80);
export const acceptedVersionSchema = z.string().trim().refine((value) => semver.valid(value) !== null, "Invalid semantic version");
export function validateAcceptedVersionRange(minimum: string | null | undefined, maximum: string | null | undefined) {
  const min = minimum ? semver.valid(minimum) : null;
  const max = maximum ? semver.valid(maximum) : null;
  if (minimum && !min || maximum && !max || min && max && semver.gt(min, max)) throw new Error("INVALID_VERSION_POLICY");
  return { minimum: min, maximum: max };
}
export function isVersionAccepted(version: string, minimum: string | null | undefined, maximum: string | null | undefined) {
  const parsed = semver.valid(version);
  if (!parsed) throw new Error("INVALID_LICENSE_VERSION");
  const range = validateAcceptedVersionRange(minimum, maximum);
  return (!range.minimum || semver.gte(parsed, range.minimum)) && (!range.maximum || semver.lte(parsed, range.maximum));
}

export function assertProductIdChangeAllowed(input: {
  existingProductId: string | null;
  requestedProductId: string;
  lifecycleLocked: boolean;
}) {
  if (input.existingProductId && input.existingProductId !== input.requestedProductId && input.lifecycleLocked) {
    throw new Error("PRODUCT_ID_IMMUTABLE");
  }
}
