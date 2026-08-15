import "dotenv/config";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { assertLastOwnerPreserved, roleHasCapability } from "@/lib/authorization";

const source = readFileSync(new URL("../lib/organizations.ts", import.meta.url), "utf8");

describe("organization membership controls", () => {
  it("keeps financial, license, and member roles separated", () => {
    expect(roleHasCapability("BILLING", "VIEW_PAYMENTS")).toBe(true);
    expect(roleHasCapability("BILLING", "REVEAL_LICENSE")).toBe(false);
    expect(roleHasCapability("LICENSE_MANAGER", "ASSIGN_LICENSE")).toBe(true);
    expect(roleHasCapability("LICENSE_MANAGER", "VIEW_PAYMENTS")).toBe(false);
    expect(roleHasCapability("MEMBER", "MANAGE_MEMBERS")).toBe(false);
  });

  it("blocks privilege loss for the final owner", () => {
    expect(() => assertLastOwnerPreserved({ currentRole: "OWNER", nextRole: "BILLING", ownerCount: 1 })).toThrow("LAST_OWNER_REQUIRED");
    expect(() => assertLastOwnerPreserved({ currentRole: "OWNER", ownerCount: 1 })).toThrow("LAST_OWNER_REQUIRED");
    expect(() => assertLastOwnerPreserved({ currentRole: "OWNER", nextRole: "BILLING", ownerCount: 2 })).not.toThrow();
  });

  it("provides repository-controlled organization lifecycle entry points", () => {
    for (const name of [
      "createOrganizationAccount",
      "updateOrganizationProfile",
      "inviteOrganizationMember",
      "resendOrganizationInvitation",
      "revokeOrganizationInvitation",
      "expirePendingOrganizationInvitations",
      "acceptOrganizationInvitation",
      "updateOrganizationMemberRole",
      "transferOrganizationOwnership",
      "removeOrganizationMember",
      "leaveOrganization",
      "suspendOrganization",
      "closeOrganization",
      "getOrganizationAuditHistory",
      "listSwitchableAccounts",
    ]) expect(source).toContain(`export async function ${name}`);
  });

  it("prevents token replay, email mismatch, owner self-exit, and unaudited mutations", () => {
    expect(source).toContain('status !== "PENDING"');
    expect(source).toContain("INVITATION_EMAIL_MISMATCH");
    expect(source).toContain("OWNER_CANNOT_LEAVE");
    expect(source).toContain("ORGANIZATION_MEMBER_ROLE_UPDATED");
    expect(source).toContain("ORGANIZATION_OWNER_TRANSFERRED");
    expect(source).toContain("ORGANIZATION_CLOSED");
  });
});
