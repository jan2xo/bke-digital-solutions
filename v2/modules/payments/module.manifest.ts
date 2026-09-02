import type { ModuleManifest } from "../../contracts/capability";
import { PAYMENTS_CHECKOUT_ATTEMPT_CAPABILITY_ID } from "./contracts/checkout-attempt.contract";
import { PAYMENTS_PROVIDER_EVENT_INGESTION_CAPABILITY_ID } from "./contracts/provider-event-ingestion.contract";

export const paymentsModuleManifest = Object.freeze({
  moduleId: "payments",
  needs: [],
  provides: [
    PAYMENTS_CHECKOUT_ATTEMPT_CAPABILITY_ID,
    PAYMENTS_PROVIDER_EVENT_INGESTION_CAPABILITY_ID,
  ],
} satisfies ModuleManifest);
