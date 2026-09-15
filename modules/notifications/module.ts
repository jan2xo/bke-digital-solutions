import { NOTIFICATIONS_INTENT_CAPABILITY_ID } from "@bke/notifications/contracts/notification-intent.contract";
import { createNotificationsIntentCapability } from "@bke/notifications/logic/notification-intent";
import { notificationsModuleManifest } from "@bke/notifications/module.manifest";
import type { CapabilityModule } from "../../contracts/capability";

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
