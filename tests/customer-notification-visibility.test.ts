import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountNotificationHighlights } from "@/components/account-notification-highlights";
import type { WebNotificationItem } from "@/apps/web/notifications/center";

function example(accountId: string, state: "UNREAD" | "READ" = "UNREAD"): WebNotificationItem {
  return {
    id: "notification-" + accountId,
    source: "payments",
    event: "PAYMENT_RECEIVED",
    title: "Payment received " + accountId,
    body: "Your order is confirmed.",
    category: "TRANSACTIONAL",
    priority: "NORMAL",
    createdAt: new Date("2026-11-09T04:00:00Z"),
    expiresAt: null,
    state,
    audienceKind: "ACCOUNT",
    accountId,
    accountName: null,
    productId: null,
    data: null,
  };
}

describe("customer account notification visibility", () => {
  it("shows only authorized selected-account records, never notices from a different account", () => {
    const html = renderToStaticMarkup(
      AccountNotificationHighlights({ accountId: "mine", items: [example("other"), example("mine")] }),
    );
    expect(html).toContain("Payment received mine");
    expect(html).not.toContain("Payment received other");
    expect(html).toContain("1 unread in recent activity");
    expect(html).toContain("/dashboard/notifications");
  });

  it("is safe with no notifications or only dismissed/other-account notices", () => {
    const html = renderToStaticMarkup(
      AccountNotificationHighlights({ accountId: "mine", items: [example("other")] }),
    );
    expect(html).toContain("No account notifications yet.");
    expect(html).not.toContain("unread in recent activity");
  });

  it("exposes ordinary customer account navigation only through the existing authorized inbox", () => {
    const page = readFileSync("app/dashboard/accounts/[accountId]/page.tsx", "utf8");
    const inbox = readFileSync("components/notification-inbox.tsx", "utf8");
    const customerPage = readFileSync("app/dashboard/notifications/page.tsx", "utf8");
    expect(page).toContain("AccountNotificationHighlights accountId={accountId}");
    expect(page).toContain("listNotificationsForUser({ userId: user.id, role: user.role");
    expect(customerPage).toContain("<NotificationInbox items={items} allowAccountNavigation/>");
    expect(inbox).toContain('item.audienceKind === "ACCOUNT"');
    expect(inbox).toContain('encodeURIComponent(item.accountId)');
    expect(inbox).not.toContain("licenseKey");
    expect(inbox).not.toContain("notification.data.url");
  });
});
