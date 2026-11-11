import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { philippineDateTimeLocalToIso } from "@/apps/web/display-time";

describe("BKE Philippine Standard Time UI boundary", () => {
  it("shows the next Philippine calendar day for an instant still dated yesterday in UTC", () => {
    const instant = new Date("2026-11-11T16:15:00.000Z");
    const formatted = instant.toLocaleString("en-PH", { timeZone: "Asia/Manila" });
    expect(formatted).toBeTruthy();
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-PH", {
        timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit"
      }).formatToParts(instant).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
    );
    expect(parts).toMatchObject({ year: "2026", month: "11", day: "12" });
    // The authoritative UTC instant remains unchanged.
    expect(instant.toISOString()).toBe("2026-11-11T16:15:00.000Z");
  });

  it("converts explicit PHT wall-clock input into UTC for offer API transport", () => {
    expect(philippineDateTimeLocalToIso("2026-11-12T00:15"))
      .toBe("2026-11-11T16:15:00.000Z");
    expect(philippineDateTimeLocalToIso("2026-01-01T00:00"))
      .toBe("2025-12-31T16:00:00.000Z");
    for (const bad of ["", "2026-02-30T10:00", "2026-11-12T24:00", "2026-11-12T12:60", "2026-11-12T10:10Z"]) {
      expect(() => philippineDateTimeLocalToIso(bad)).toThrow("INVALID_PHILIPPINE_DATETIME_LOCAL");
    }
  });

  it("does not leave implicit runtime-zone date formatting in the audited admin and customer UI", () => {
    const datePresentationFiles = [
      "app/admin/audit/page.tsx",
      "app/admin/page.tsx",
      "app/admin/orders/page.tsx",
      "app/admin/scheduler/page.tsx",
      "app/admin/customers/[id]/page.tsx",
      "app/admin/invoices/page.tsx",
      "app/admin/licenses/page.tsx",
      "app/admin/payments/page.tsx",
      "app/admin/security/page.tsx",
      "app/admin/records/page.tsx",
      "app/admin/subscriptions/page.tsx",
      "app/admin/backups/page.tsx",
      "app/admin/observability/page.tsx",
      "app/admin/security/commercial-signing-keys/page.tsx",
      "app/admin/devices/page.tsx",
      "app/dashboard/accounts/[accountId]/page.tsx",
      "components/admin-legal-center.tsx",
      "components/admin-offer-manager.tsx",
      "components/admin-provider-manager.tsx",
      "components/admin-trial-manager.tsx",
      "components/notification-inbox.tsx",
      "components/legal-document-view.tsx"
];
    for (const path of datePresentationFiles) {
      const source = readFileSync(path, "utf8");
      expect(source, path).toContain('timeZone: "Asia/Manila"');
      // Money can still use toLocaleString(), but date-like fields must not.
      expect(source, path).not.toMatch(/\b(?:createdAt|issuedAt|expiresAt|currentPeriodStart|currentPeriodEnd|lastSeenAt|lastRunAt|lastSuccessAt|activatedAt|retiredAt|graceEndsAt|trialEndsAt)\?*\.toLocale(?:String|DateString|TimeString)\(\)/);
    }
  });
});
