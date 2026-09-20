import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const paymentWebhook = readFileSync(
  "apps/web/payments/webhook-processing.ts",
  "utf8",
);
const scheduler = readFileSync(
  "apps/web/scheduler/handlers.ts",
  "utf8",
);
const email = readFileSync(
  "apps/web/email.ts",
  "utf8",
);
const notificationCenter = readFileSync(
  "apps/web/notifications/center.ts",
  "utf8",
);
const notificationsModule = readFileSync(
  "modules/notifications/module.ts",
  "utf8",
);
const securitySessions = readFileSync(
  "apps/web/security/session-administration.ts",
  "utf8",
);
const agentRoute = readFileSync(
  "app/api/agent-sessions/notifications/route.ts",
  "utf8",
);

describe("V3 notification routing", () => {
  it("keeps normal commerce out of automatic Resend delivery", () => {
    for (const retired of [
      "PAYMENT_RECEIPT",
      "LICENSE_ISSUED",
      "PAYMENT_FAILED",
      "REFUND_CONFIRMED",
      "RENEWAL_REMINDER",
      "SUBSCRIPTION_EXPIRED",
      "TRIAL_ENDING",
      "TRIAL_EXPIRED",
      "LICENSE_EXPIRED",
    ]) {
      expect(paymentWebhook).not.toContain(`type: "${retired}"`);
    }
    expect(paymentWebhook).not.toContain("queueCommerceEmail");
    expect(paymentWebhook).not.toContain("dispatchEmailOutbox");
  });

  it("retires stale commerce email rows and keeps the durable email allowlist narrow", () => {
    expect(scheduler).toContain("EMAIL_CHANNEL_RETIRED");
    expect(scheduler).toContain("durable-notification-center");
    expect(scheduler).not.toContain("queueCommerceEmail");

    for (const allowed of [
      "INVOICE_ISSUED",
      "SECURITY_SESSIONS_REVOKED",
      "SECURITY_NEW_SESSION",
      "SECURITY_ACCOUNT_CHANGED",
    ]) {
      expect(email).toContain(`"${allowed}"`);
    }

    expect(email).not.toContain('"PAYMENT_RECEIPT"');
    expect(email).not.toContain('"RENEWAL_REMINDER"');
    expect(email).not.toContain('"TRIAL_ENDING"');
  });

  it("uses released Notifications package for durable inbox policy", () => {
    expect(notificationsModule).toContain(
      "NOTIFICATIONS_INBOX_POLICY_CAPABILITY_ID",
    );
    expect(notificationsModule).toContain(
      "createNotificationsInboxPolicyCapability",
    );
    expect(notificationCenter).toContain(
      "NOTIFICATIONS_INTENT_CAPABILITY_ID",
    );
    expect(notificationCenter).toContain(
      "NOTIFICATIONS_INBOX_POLICY_CAPABILITY_ID",
    );
    expect(notificationCenter).toContain("transitionReceipt");
    expect(notificationCenter).toContain("notificationMessage");
    expect(notificationCenter).toContain("notificationReceipt");
  });

  it("routes account admin and principal notification scopes without email", () => {
    expect(paymentWebhook).toContain('kind: "ACCOUNT"');
    expect(scheduler).toContain('kind: "ADMINISTRATORS"');
    expect(securitySessions).toContain('kind: "PRINCIPAL"');
    for (const event of [
      "PAYMENT_RECEIVED",
      "PAYMENT_FAILED",
      "REFUND_CONFIRMED",
      "INVOICE_READY",
      "LICENSE_READY",
      "RENEWAL_APPROACHING",
      "SUBSCRIPTION_EXPIRED",
      "TRIAL_ENDING",
      "TRIAL_EXPIRED",
      "LICENSE_EXPIRED",
      "CUSTOMER_LIFECYCLE_REVIEW",
      "PAYMENT_OPERATIONS_REVIEW",
      "ADMIN_SESSIONS_REVOKED",
    ]) {
      expect(
        paymentWebhook.includes(`event: "${event}"`) ||
        scheduler.includes(`event: "${event}"`) ||
        securitySessions.includes(`event: "${event}"`),
      ).toBe(true);
    }
  });

  it("requires the Agent account-session authority for durable customer notifications", () => {
    expect(agentRoute).toContain("requireAgentAccountSessionProtocol");
    expect(agentRoute).toContain("authenticateAgentAccessToken");
    expect(agentRoute).toContain("AGENT_ACCOUNT_SESSION_PEPPER");
    expect(agentRoute).toContain("listAccountProductNotifications");
    expect(agentRoute).toContain('productId: input.product_id');
    expect(agentRoute).toContain('"cache-control": "no-store"');
  });
});
