import "dotenv/config";
import { describe, expect, it } from "vitest";
import { assertLastOwnerPreserved, roleHasCapability } from "@/lib/authorization";

describe("customer account capability matrix", () => {
  it("limits billing members to financial and checkout capabilities", () => {
    expect(roleHasCapability("BILLING", "VIEW_ORDERS")).toBe(true);
    expect(roleHasCapability("BILLING", "PURCHASE")).toBe(true);
    expect(roleHasCapability("BILLING", "REVEAL_LICENSE")).toBe(false);
    expect(roleHasCapability("BILLING", "DEACTIVATE_DEVICE")).toBe(false);
  });

  it("limits license managers to entitlement operations", () => {
    expect(roleHasCapability("LICENSE_MANAGER", "VIEW_LICENSES")).toBe(true);
    expect(roleHasCapability("LICENSE_MANAGER", "DOWNLOAD_INSTALLER")).toBe(true);
    expect(roleHasCapability("LICENSE_MANAGER", "VIEW_PAYMENTS")).toBe(false);
    expect(roleHasCapability("LICENSE_MANAGER", "PURCHASE")).toBe(false);
  });

  it("does not grant plain members broad commerce or licensing access", () => {
    expect(roleHasCapability("MEMBER", "VIEW_ORDERS")).toBe(false);
    expect(roleHasCapability("MEMBER", "VIEW_LICENSES")).toBe(false);
    expect(roleHasCapability("MEMBER", "DOWNLOAD_INSTALLER")).toBe(false);
  });

  it("protects the last organization owner", () => {
    expect(() => assertLastOwnerPreserved({ currentRole: "OWNER", nextRole: "MEMBER", ownerCount: 1 })).toThrow("LAST_OWNER_REQUIRED");
    expect(() => assertLastOwnerPreserved({ currentRole: "OWNER", nextRole: "MEMBER", ownerCount: 2 })).not.toThrow();
  });
});
