import type { CapabilityModule } from "../../contracts/capability";
import { NOTIFICATIONS_DECISION_CAPABILITY_ID } from "./contracts/notification-decision.contract";
import { createNotificationsDecisionCapability } from "./logic/notification-decision";
import { notificationsModuleManifest } from "./module.manifest";

export const notificationsModule: CapabilityModule = Object.freeze({
  manifest: notificationsModuleManifest,
  start() {
    return [
      {
        id: NOTIFICATIONS_DECISION_CAPABILITY_ID,
        value: createNotificationsDecisionCapability(),
      },
    ];
  },
});
