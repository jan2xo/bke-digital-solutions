/**
 * Digital Solutions is the source of truth for how a product may activate.
 *
 * Product.licenseType describes the commercial license classification. Never
 * overload it with account sign-in policy. Product.activationMode is distinct.
 *
 * EITHER is the migration-safe default: legacy key activations and existing
 * BKE account entitlements both remain eligible for their *own* trust checks.
 * EITHER is not permission to skip those checks or combine their identities.
 */
export const productActivationModes = ["ACCOUNT", "LICENSE_KEY", "EITHER"] as const;
export type ProductActivationMode = (typeof productActivationModes)[number];
export type ActivationCredential = "ACCOUNT" | "LICENSE_KEY";

export function allowsProductActivation(
  mode: unknown,
  credential: ActivationCredential,
): boolean {
  if (credential === "ACCOUNT") return mode === "ACCOUNT" || mode === "EITHER";
  if (credential === "LICENSE_KEY") return mode === "LICENSE_KEY" || mode === "EITHER";
  return false;
}

export type ActivationModeChangeEvidence = Readonly<{
  previousMode: string;
  requestedMode: string;
  active: boolean;
  publishedAt: Date | null;
  versionsCount: number;
  licensesCount: number;
  orderItemsCount: number;
}>;

/**
 * Fail closed on invalid policy and prevent silently stranding existing rights.
 * The admin caller MUST evaluate this after locking the Product row inside
 * the same database transaction that updates the activationMode value.
 */
export function assertSafeProductActivationModeChange(
  evidence: ActivationModeChangeEvidence,
): void {
  const { previousMode, requestedMode } = evidence;
  if (!productActivationModes.includes(previousMode as ProductActivationMode) ||
      !productActivationModes.includes(requestedMode as ProductActivationMode)) {
    throw new Error("PRODUCT_ACTIVATION_MODE_INVALID");
  }
  if (previousMode === requestedMode) return;
  if (evidence.active || evidence.publishedAt !== null ||
      !Number.isSafeInteger(evidence.versionsCount) || evidence.versionsCount < 0 ||
      !Number.isSafeInteger(evidence.licensesCount) || evidence.licensesCount < 0 ||
      !Number.isSafeInteger(evidence.orderItemsCount) || evidence.orderItemsCount < 0 ||
      evidence.versionsCount !== 0 || evidence.licensesCount !== 0 ||
      evidence.orderItemsCount !== 0) {
    throw new Error("PRODUCT_ACTIVATION_MODE_LOCKED");
  }
}
