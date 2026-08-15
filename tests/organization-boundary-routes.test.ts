import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("customer-facing organization boundary routes", () => {
  it("keeps organization APIs authenticated, same-origin protected, and backed by repository services", () => {
    for (const path of [
      "app/api/organizations/route.ts",
      "app/api/organizations/[id]/route.ts",
      "app/api/organizations/[id]/invitations/route.ts",
      "app/api/organizations/invitations/accept/route.ts",
      "app/api/organizations/[id]/members/[userId]/route.ts",
      "app/api/organizations/[id]/owner/route.ts",
      "app/api/organizations/[id]/leave/route.ts",
      "app/api/organizations/[id]/lifecycle/route.ts",
    ]) {
      const source = read(path);
      expect(source).toContain("requireUser");
      if (source.includes("POST") || source.includes("PATCH") || source.includes("DELETE")) expect(source).toContain("assertSameOrigin");
      expect(source).toMatch(/@\/lib\/(organizations|authorization)/);
      expect(source).not.toContain("support");
      expect(source).not.toContain("production");
    }
  });

  it("exposes replay, expiry, revocation, owner transfer, last-owner, switching, and billing/license visibility semantics", () => {
    expect(read("app/api/organizations/[id]/invitations/route.ts")).toMatch(/resendOrganizationInvitation|revokeOrganizationInvitation|expirePendingOrganizationInvitations/);
    expect(read("app/api/organizations/invitations/accept/route.ts")).toContain("acceptOrganizationInvitation");
    expect(read("app/api/organizations/[id]/owner/route.ts")).toContain("transferOrganizationOwnership");
    expect(read("app/api/organizations/[id]/members/[userId]/route.ts")).toMatch(/updateOrganizationMemberRole|removeOrganizationMember/);
    expect(read("app/api/organizations/route.ts")).toContain("listSwitchableAccounts");
    expect(read("app/api/organizations/[id]/route.ts")).toMatch(/VIEW_PAYMENTS|VIEW_LICENSES/);
    expect(read("lib/http.ts")).toMatch(/INVITATION_EXPIRED: 410|LAST_OWNER_REQUIRED: 409/);
  });
});
