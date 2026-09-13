import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const organizationRoutes = [
  "app/api/organizations/route.ts",
  "app/api/organizations/[id]/route.ts",
  "app/api/organizations/[id]/invitations/route.ts",
  "app/api/organizations/invitations/accept/route.ts",
  "app/api/organizations/[id]/members/[userId]/route.ts",
  "app/api/organizations/[id]/owner/route.ts",
  "app/api/organizations/[id]/leave/route.ts",
  "app/api/organizations/[id]/lifecycle/route.ts",
];

describe("customer-facing organization boundary routes", () => {
  it("keeps organization APIs authenticated, same-origin protected, and delegated to V2 Accounts operations", () => {
    for (const path of organizationRoutes) {
      const source = read(path);
      expect(source).toContain("requireIdentityUser");
      if (source.includes("POST") || source.includes("PATCH") || source.includes("DELETE")) {
        expect(source).toContain("assertSameOrigin");
      }
      expect(source).toContain("@/v2/apps/web/accounts/organization-operations");
      expect(source).not.toContain("@/lib/organizations");
      expect(source).not.toMatch(/from\s+["']@\/lib\/auth["']/);
      expect(source).not.toContain("support");
      expect(source).not.toContain("production");
    }
  });

  it("exposes replay, expiry, revocation, owner transfer, last-owner, switching, and billing/license visibility semantics", () => {
    expect(read("app/api/organizations/[id]/invitations/route.ts")).toMatch(
      /resendOrganizationInvitation|revokeOrganizationInvitation|expirePendingOrganizationInvitations/,
    );
    expect(read("app/api/organizations/invitations/accept/route.ts")).toContain("acceptOrganizationInvitation");
    expect(read("app/api/organizations/[id]/owner/route.ts")).toContain("transferOrganizationOwnership");
    expect(read("app/api/organizations/[id]/members/[userId]/route.ts")).toMatch(
      /updateOrganizationMemberRole|removeOrganizationMember/,
    );
    expect(read("app/api/organizations/route.ts")).toContain("listSwitchableAccounts");
    expect(read("app/api/organizations/[id]/route.ts")).toMatch(/VIEW_PAYMENTS|VIEW_LICENSES/);
    const apiErrors = read("v2/apps/web/http/api-error.ts");
    expect(apiErrors).toContain("INVITATION_EXPIRED: 410");
    expect(apiErrors).toContain("LAST_OWNER_REQUIRED: 409");
  });

  it("does not leak invitation token hashes from the retained rich account detail read model (F-001)", () => {
    const source = read("app/api/organizations/[id]/route.ts");
    expect(source).toContain("invitations: canManageMembers");
    expect(source).toContain("select: {");
    expect(source).toMatch(
      /id:\s*true,\s*email:\s*true,\s*role:\s*true,\s*status:\s*true,\s*expiresAt:\s*true,\s*createdAt:\s*true/,
    );
    expect(source).not.toContain("tokenHash");
  });

  it("requires recent authentication for license reveal (F-004)", () => {
    const source = read("app/api/licenses/[id]/reveal/route.ts");
    expect(source).toContain("requireRecentUser");
    expect(source).toMatch(/RECENT_AUTH_REQUIRED|requireRecentUser/);
  });

  it("requires verified email and V2 Legal reacceptance clearance for organization creation (F-003)", () => {
    const source = read("app/api/organizations/route.ts");
    expect(source).toContain("EMAIL_NOT_VERIFIED");
    expect(source).toContain("LEGAL_REACCEPTANCE_STATUS_CAPABILITY_ID");
    expect(source).toContain("reacceptance.check");
    expect(source).not.toContain("@/lib/legal/service");

    const reveal = read("app/api/licenses/[id]/reveal/route.ts");
    expect(reveal).toContain("assertLegalAcceptanceCurrent");
  });
});
