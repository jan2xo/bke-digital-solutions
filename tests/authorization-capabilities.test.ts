import "dotenv/config";
import { describe, expect, it } from "vitest";
import { assertLastOwnerPreserved, roleHasCapability } from "@/lib/authorization";

describe("customer account capability matrix", () => {
  it("limits billing members to financial and checkout capabilities", () => {
    expect(roleHasCapability("BILLING", "VIEW_ORDERS")).toBe(true);
    expect(roleHasCapability("BILLING", "PURCHASE")).toBe(true);
    expect(roleHasCapability("BILLING", "REVEAL_LICENSE")).toBe(false);
    expect(roleHasCapability("BILLING", "DEACTIVATE_DEVICE")).toBe(false);
    expect(roleHasCapability("BILLING", "CLAIM_ENTITLEMENT")).toBe(true);
    expect(roleHasCapability("BILLING", "MANAGE_CLAIM_CODES")).toBe(true);
  });

  it("limits license managers to entitlement operations", () => {
    expect(roleHasCapability("LICENSE_MANAGER", "VIEW_LICENSES")).toBe(true);
    expect(roleHasCapability("LICENSE_MANAGER", "DOWNLOAD_INSTALLER")).toBe(true);
    expect(roleHasCapability("LICENSE_MANAGER", "VIEW_PAYMENTS")).toBe(false);
    expect(roleHasCapability("LICENSE_MANAGER", "PURCHASE")).toBe(false);
    expect(roleHasCapability("LICENSE_MANAGER", "CLAIM_ENTITLEMENT")).toBe(true);
    expect(roleHasCapability("LICENSE_MANAGER", "MANAGE_CLAIM_CODES")).toBe(true);
  });

  it("does not grant plain members broad commerce or licensing access", () => {
    expect(roleHasCapability("MEMBER", "VIEW_ORDERS")).toBe(false);
    expect(roleHasCapability("MEMBER", "VIEW_LICENSES")).toBe(false);
    expect(roleHasCapability("MEMBER", "DOWNLOAD_INSTALLER")).toBe(false);
    expect(roleHasCapability("MEMBER", "CLAIM_ENTITLEMENT")).toBe(false);
    expect(roleHasCapability("MEMBER", "MANAGE_CLAIM_CODES")).toBe(false);
  });

  it("protects the last organization owner", () => {
    expect(() => assertLastOwnerPreserved({ currentRole: "OWNER", nextRole: "MEMBER", ownerCount: 1 })).toThrow("LAST_OWNER_REQUIRED");
    expect(() => assertLastOwnerPreserved({ currentRole: "OWNER", nextRole: "MEMBER", ownerCount: 2 })).not.toThrow();
  });
});
