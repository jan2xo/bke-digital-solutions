import type { ModuleManifest } from "../../contracts/capability";
import { NOTIFICATIONS_DECISION_CAPABILITY_ID } from "./contracts/notification-decision.contract";

export const notificationsModuleManifest = Object.freeze({
  moduleId: "notifications",
  needs: [],
  provides: [NOTIFICATIONS_DECISION_CAPABILITY_ID],
} satisfies ModuleManifest);
