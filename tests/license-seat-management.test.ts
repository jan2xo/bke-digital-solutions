import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("license seat management", () => {
  it("uses the existing Accounts ASSIGN_LICENSE capability", () => {
    const service = readFileSync("apps/web/licensing/license-seat-management.ts", "utf8");
    expect(service).toContain('roleHasAccountsCapability(role, "ASSIGN_LICENSE")');
    expect(service).not.toContain("V3_");
  });

  it("serializes seat mutations and enforces purchased capacity", () => {
    const service = readFileSync("apps/web/licensing/license-seat-management.ts", "utf8");
    expect(service).toContain('SELECT "id" FROM "License"');
    expect(service).toContain("FOR UPDATE");
    expect(service).toContain("license.assignments.length >= license.maxSeats");
    expect(service).toContain('throw new Error("LICENSE_SEAT_LIMIT")');
  });

  it("only assigns active verified users already belonging to the same account", () => {
    const service = readFileSync("apps/web/licensing/license-seat-management.ts", "utf8");
    expect(service).toContain('lifecycleState: "ACTIVE"');
    expect(service).toContain("emailVerified: { not: null }");
    expect(service).toContain("ownedAccounts");
    expect(service).toContain("memberships");
    expect(service).toContain('throw new Error("TARGET_NOT_ACCOUNT_MEMBER")');
  });

  it("keeps duplicate assignment and duplicate removal idempotent", () => {
    const service = readFileSync("apps/web/licensing/license-seat-management.ts", "utf8");
    expect(service).toContain('status: "EXISTING"');
    expect(service).toContain('status: "NOT_ASSIGNED"');
  });

  it("records assignment/removal in license events and audit history", () => {
    const service = readFileSync("apps/web/licensing/license-seat-management.ts", "utf8");
    expect(service).toContain('type: "SEAT_ASSIGNED"');
    expect(service).toContain('action: "LICENSE_SEAT_ASSIGNED"');
    expect(service).toContain('type: "SEAT_REMOVED"');
    expect(service).toContain('action: "LICENSE_SEAT_REMOVED"');
  });

  it("exposes assignment APIs and a customer seat manager", () => {
    const assign = readFileSync("app/api/licenses/[id]/assignments/route.ts", "utf8");
    const remove = readFileSync("app/api/licenses/[id]/assignments/[userId]/route.ts", "utf8");
    const page = readFileSync("app/dashboard/accounts/[accountId]/licenses/[licenseId]/seats/page.tsx", "utf8");
    const component = readFileSync("components/license-seat-manager.tsx", "utf8");

    expect(assign).toContain("assignLicenseSeat");
    expect(remove).toContain("removeLicenseSeat");
    expect(page).toContain("LicenseSeatManager");
    expect(component).toContain("Assign seat");
    expect(component).toContain("Remove seat");
  });

  it("maps seat-specific failures to stable HTTP outcomes", () => {
    const apiError = readFileSync("apps/web/http/api-error.ts", "utf8");
    expect(apiError).toContain("LICENSE_NOT_ACTIVE: 409");
    expect(apiError).toContain("TARGET_NOT_ACCOUNT_MEMBER: 422");
    expect(apiError).toContain("LICENSE_SEAT_LIMIT: 409");
  });
});
