import type { CapabilityModule } from "../../contracts/capability";
import { NOTIFICATIONS_INTENT_CAPABILITY_ID } from "./contracts/notification-intent.contract";
import { createNotificationsIntentCapability } from "./logic/notification-intent";
import { notificationsModuleManifest } from "./module.manifest";

export const notificationsModule: CapabilityModule = Object.freeze({
  manifest: notificationsModuleManifest,
  start() {
    return [
      {
        id: NOTIFICATIONS_INTENT_CAPABILITY_ID,
        value: createNotificationsIntentCapability(),
      },
    ];
  },
});
