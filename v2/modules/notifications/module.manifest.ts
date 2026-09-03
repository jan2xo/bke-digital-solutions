import type { ModuleManifest } from "../../contracts/capability";
import { NOTIFICATIONS_INTENT_CAPABILITY_ID } from "./contracts/notification-intent.contract";

export const notificationsModuleManifest = Object.freeze({
  moduleId: "notifications",
  needs: [],
  provides: [NOTIFICATIONS_INTENT_CAPABILITY_ID],
} satisfies ModuleManifest);
