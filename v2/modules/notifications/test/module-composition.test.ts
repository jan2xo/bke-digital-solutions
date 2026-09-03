import { describe, expect, it } from "vitest";
import { composeCapabilities } from "../../../platform/composition/composer";
import {
  NOTIFICATIONS_DECISION_CAPABILITY_ID,
  type NotificationsDecisionCapability,
} from "../contracts/notification-decision.contract";
import { notificationsModule } from "../module";

describe("Notifications module composition", () => {
  it("registers the transport-neutral notification decision capability", async () => {
    const application = await composeCapabilities([notificationsModule]);

    expect(application.moduleIds).toContain("notifications");
    expect(application.has(NOTIFICATIONS_DECISION_CAPABILITY_ID)).toBe(true);
    expect(
      typeof application.get<NotificationsDecisionCapability>(
        NOTIFICATIONS_DECISION_CAPABILITY_ID,
      ).decide,
    ).toBe("function");
  });
});
