import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildMySoftwarePresentation,
  planTypeLabel,
  type MySoftwareLicense,
  type MySoftwareSubscription,
} from "@/apps/web/accounts/my-software-presentation";

const account = readFileSync("app/dashboard/accounts/[accountId]/page.tsx", "utf8");
const card = readFileSync("components/customer-license-card.tsx", "utf8");
const keyApi = readFileSync("app/api/licenses/[id]/reveal/route.ts", "utf8");
const agentApi = readFileSync("app/api/agent-sessions/account/purchases/route.ts", "utf8");

function license(id: string, subscriptionId: string | null = null): MySoftwareLicense {
  return {
    id, subscriptionId, productName: "Render Dock", editionName: "Professional",
    planType: "MONTHLY", status: "ACTIVE", expiresAt: "2026-12-09T00:00:00Z",
    maxSeats: 1, assignedSeats: 0, maxDevices: 1, activeDevices: 0,
  };
}

function subscription(id: string): MySoftwareSubscription {
  return {
    id, productName: "Render Dock", editionName: "Professional",
    planType: "MONTHLY", status: "ACTIVE", seats: 1,
    currentPeriodEnd: "2026-12-09T00:00:00Z",
  };
}

describe("keyless My Software web projection", () => {
  it("links a license and its subscription only once, retaining the authorized renewal", () => {
    const result = buildMySoftwarePresentation({
      licenses: [license("one", "sub-1")],
      subscriptions: [subscription("sub-1")],
      canViewSubscriptions: true,
    });
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].subscription?.status).toBe("ACTIVE");
    expect(result.cards[0].showRenewal).toBe(true);
    expect(result.cards[0].periodThrough).toBe("2026-12-09T00:00:00Z");
    expect(result.unlinkedSubscriptions).toHaveLength(0);
  });

  it("does not duplicate renewal buttons for multiple licenses on one subscription", () => {
    const result = buildMySoftwarePresentation({
      licenses: [license("one", "sub-1"), license("two", "sub-1")],
      subscriptions: [subscription("sub-1")], canViewSubscriptions: true,
    });
    expect(result.cards.map((item) => item.showRenewal)).toEqual([true, false]);
    expect(result.unlinkedSubscriptions).toHaveLength(0);
  });

  it("keeps unmatched subscriptions visible to billing roles and prevents private billing metadata for assigned-only viewers", () => {
    const visible = buildMySoftwarePresentation({
      licenses: [license("one", null)],
      subscriptions: [subscription("sub-1")], canViewSubscriptions: true,
    });
    expect(visible.unlinkedSubscriptions.map((item) => item.id)).toEqual(["sub-1"]);
    const assignedOnly = buildMySoftwarePresentation({
      licenses: [license("one", "sub-1")],
      subscriptions: [subscription("sub-1")], canViewSubscriptions: false,
    });
    expect(assignedOnly.cards[0].subscription).toBe(null);
    expect(assignedOnly.cards[0].showRenewal).toBe(false);
    expect(assignedOnly.unlinkedSubscriptions).toEqual([]);
  });

  it("handles perpetual and empty entitlements without fabricating dates", () => {
    const perpetual = buildMySoftwarePresentation({
      licenses: [{ ...license("perpetual"), planType: "PERPETUAL", expiresAt: null }],
      subscriptions: [], canViewSubscriptions: true,
    });
    expect(perpetual.cards[0].periodThrough).toBeNull();
    expect(planTypeLabel("PERPETUAL")).toBe("Perpetual");
    expect(planTypeLabel(null)).toBe("Legacy plan");
    expect(buildMySoftwarePresentation({ licenses: [], subscriptions: [], canViewSubscriptions: false }).cards).toEqual([]);
  });

  it("removes plaintext key handling only from customer web UI; keeps secure backend for legacy consumers", () => {
    expect(account).toContain("My Software");
    expect(card).not.toContain("Reveal license key");
    expect(card).not.toContain("/api/licenses/");
    expect(card).not.toContain("licenseKey");
    expect(card).not.toContain("keyCiphertext");
    expect(account).not.toContain("keyLastFour");
    expect(keyApi).toContain("decryptLicenseKey(license.keyCiphertext)");
    expect(keyApi).toContain("requireRecentUser()");
    expect(agentApi).toContain("authenticateNativeAgentRequest");
  });

  it("preserves role-gated device and seat actions, gift claims, trials, receipts and renewals", () => {
    expect(account).toContain('roleHasAccountsCapability(account.effectiveRole, "DEACTIVATE_DEVICE")');
    expect(account).toContain('roleHasAccountsCapability(account.effectiveRole, "ASSIGN_LICENSE")');
    expect(account).toContain('account.effectiveRole === "OWNER" || account.effectiveRole === "BILLING"');
    expect(account).toContain('item.subscription?.status === "ACTIVE"');
    expect(account).toContain('canViewSubscriptions');
    expect(account).toContain('trialGrant');
    expect(account).toContain("GiftClaimCodes");
    expect(account).toContain("AccountNotificationHighlights");
    expect(account).toContain("View invoice");
    expect(card).toContain("license.canManageDevices");
    expect(card).toContain("/api/devices/");
    expect(card).toContain('href="/bke"');
  });
});
