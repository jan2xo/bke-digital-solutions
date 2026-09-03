import { describe, expect, it } from "vitest";
import { decideNotification } from "../logic/notification-decision";

const now = new Date("2026-09-03T00:00:00.000Z");

describe("Notifications decision capability", () => {
  it("notifies one authenticated user about a login promotion", () => {
    const result = decideNotification({
      notificationKey: "promo-50-login",
      audience: { kind: "USER", userId: "user-123" },
      trigger: { kind: "LOGIN" },
      content: {
        category: "PROMOTION",
        title: "50% OFF",
        body: "Your account is eligible for 50% off.",
      },
      rules: { requireAuthenticated: true },
      context: { now, authenticated: true },
    });

    expect(result.status).toBe("NOTIFY");
    if (result.status !== "NOTIFY") return;
    expect(result.value.audience).toEqual({ kind: "USER", userId: "user-123" });
    expect(result.value.trigger).toEqual({ kind: "LOGIN" });
    expect(result.value.dedupeKey).toBe("promo-50-login:user:user-123");
  });

  it("notifies a first visitor on site entry", () => {
    const result = decideNotification({
      notificationKey: "welcome-first-visit",
      audience: { kind: "VISITOR", visitorId: "visitor-001" },
      trigger: { kind: "SITE_ENTRY" },
      content: {
        category: "ANNOUNCEMENT",
        title: "Welcome",
        body: "Welcome to BKE Digital Solutions.",
      },
      rules: { requireFirstVisit: true },
      context: { now, firstVisit: true },
    });

    expect(result.status).toBe("NOTIFY");
  });

  it("supports notify-all without resolving delivery transports", () => {
    const result = decideNotification({
      notificationKey: "platform-announcement",
      audience: { kind: "ALL_USERS" },
      trigger: { kind: "MANUAL" },
      content: {
        category: "ANNOUNCEMENT",
        title: "Announcement",
        body: "A new BKE capability is available.",
      },
      context: { now },
    });

    expect(result.status).toBe("NOTIFY");
    if (result.status !== "NOTIFY") return;
    expect(result.value.audience).toEqual({ kind: "ALL_USERS" });
    expect(result.value.dedupeKey).toBe("platform-announcement:all-users");
  });

  it("supports broadcasting to all active clients", () => {
    const result = decideNotification({
      notificationKey: "active-client-maintenance",
      audience: { kind: "ALL_ACTIVE_CLIENTS" },
      trigger: { kind: "EVENT", eventName: "maintenance.notice" },
      content: {
        category: "SYSTEM",
        title: "Maintenance notice",
        body: "Scheduled maintenance is coming.",
      },
      context: { now },
    });

    expect(result.status).toBe("NOTIFY");
  });

  it("suppresses a first-visit notification for a returning visitor", () => {
    const result = decideNotification({
      notificationKey: "welcome-first-visit",
      audience: { kind: "VISITOR" },
      trigger: { kind: "SITE_ENTRY" },
      content: { category: "ANNOUNCEMENT", title: "Welcome", body: "Hello." },
      rules: { requireFirstVisit: true },
      context: { now, firstVisit: false },
    });

    expect(result).toEqual({ status: "DO_NOT_NOTIFY", reason: "FIRST_VISIT_REQUIRED" });
  });

  it("suppresses an already-delivered notification", () => {
    const result = decideNotification({
      notificationKey: "promo-50-login",
      audience: { kind: "USER", userId: "user-123" },
      trigger: { kind: "LOGIN" },
      content: { category: "PROMOTION", title: "50% OFF", body: "Offer." },
      context: { now, alreadyDelivered: true },
    });

    expect(result).toEqual({ status: "DO_NOT_NOTIFY", reason: "ALREADY_DELIVERED" });
  });

  it("suppresses an expired notification", () => {
    const result = decideNotification({
      notificationKey: "expired-promo",
      audience: { kind: "ALL_USERS" },
      trigger: { kind: "MANUAL" },
      content: { category: "PROMOTION", title: "Old promo", body: "Expired." },
      rules: { expiresAt: new Date("2026-09-02T23:59:59.000Z") },
      context: { now },
    });

    expect(result).toEqual({ status: "DO_NOT_NOTIFY", reason: "EXPIRED" });
  });

  it("rejects invalid target identifiers", () => {
    const result = decideNotification({
      notificationKey: "bad-target",
      audience: { kind: "USER", userId: "   " },
      trigger: { kind: "MANUAL" },
      content: { category: "SYSTEM", title: "Test", body: "Test." },
      context: { now },
    });

    expect(result).toEqual({ status: "DO_NOT_NOTIFY", reason: "INVALID_INPUT" });
  });
});
