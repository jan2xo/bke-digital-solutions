import type { ModuleManifest } from "../../contracts/capability";
import { PAYMENTS_CHECKOUT_ATTEMPT_CAPABILITY_ID } from "./contracts/checkout-attempt.contract";

export const paymentsModuleManifest = Object.freeze({
  moduleId: "payments",
  needs: [],
  provides: [PAYMENTS_CHECKOUT_ATTEMPT_CAPABILITY_ID],
} satisfies ModuleManifest);
