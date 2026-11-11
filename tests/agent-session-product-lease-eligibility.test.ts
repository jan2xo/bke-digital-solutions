import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  evaluateProductLeaseEligibility,
  type ProductLeaseEvidence,
  type ProductLeaseEligibilityContext,
} from "@/apps/web/agent-sessions/product-lease-eligibility-policy";

const now = new Date("2026-11-11T12:00:00.000Z");
const hour = 3_600_000;
const later = (count: number) => new Date(now.getTime() + count * hour);
const earlier = (count: number) => new Date(now.getTime() - count * hour);

function context(extra: Partial<ProductLeaseEligibilityContext> = {}):
  ProductLeaseEligibilityContext {
  return {
    sessionId: "real-session-id",
    accountId: "server-account-id",
    userId: "server-user-id",
    productId: "render-dock",
    action: "OPEN",
    now,
    productExists: true,
    productEntitled: true,
    productInstallable: true,
    productExecutionType: "STANDALONE",
    ...extra,
  };
}
function right(extra: Partial<ProductLeaseEvidence> = {}): ProductLeaseEvidence {
  return {
    entitlementId: "ent-1",
    entitlementStatus: "ACTIVE",
    entitlementValidFrom: earlier(2),
    entitlementValidUntil: later(18),
    rightSourceVerified: true,
    licenseId: "license-1",
    licenseStatus: "ACTIVE",
    licenseExpiresAt: later(16),
    accountType: "INDIVIDUAL",
    accountOwnerId: "server-user-id",
    accountLifecycleState: "ACTIVE",
    licenseMaxSeats: 1,
    seatAssigned: false,
    purchasePlanType: "PERPETUAL",
    subscriptionId: null,
    subscriptionStatus: null,
    subscriptionPeriodStart: null,
    subscriptionPeriodEnd: null,
    trialId: null,
    trialStartsAt: null,
    trialEndsAt: null,
    trialRevokedAt: null,
    ...extra,
  };
}
function decide(
  evidence: readonly ProductLeaseEvidence[],
  extra: Partial<ProductLeaseEligibilityContext> = {},
) {
  return evaluateProductLeaseEligibility(context(extra), evidence);
}
function deny(row: Partial<ProductLeaseEvidence>, name: string) {
  it(name, () => {
    expect(decide([right(row)])).toEqual({
      status: "denied",
      reason: "NO_ACTIVE_RIGHT",
    });
  });
}

describe("DS account-product lease eligibility — non-signing L2 fraction", () => {
  it("authorizes only server-bound personal perpetual rights and preserves hard ceilings", () => {
    expect(decide([right()])).toMatchObject({
      status: "eligible",
      sessionId: "real-session-id",
      accountId: "server-account-id",
      userId: "server-user-id",
      productId: "render-dock",
      action: "OPEN",
      plan: "perpetual",
      entitlementId: "ent-1",
      licenseId: "license-1",
      rightsExpireNoLaterThan: later(16),
    });
  });

  it("caps paid subscriptions by the active period, never by the UI subscription label", () => {
    expect(decide([right({
      purchasePlanType: "MONTHLY",
      subscriptionId: "sub-1",
      subscriptionStatus: "ACTIVE",
      subscriptionPeriodStart: earlier(20),
      subscriptionPeriodEnd: later(5),
    })])).toMatchObject({
      status: "eligible",
      plan: "subscription",
      rightsExpireNoLaterThan: later(5),
    });
  });

  it("caps trials at trial end, not at an optional grace period or license expiry", () => {
    expect(decide([right({
      purchasePlanType: null,
      trialId: "trial-1",
      trialStartsAt: earlier(10),
      trialEndsAt: later(2),
    })])).toMatchObject({
      status: "eligible",
      plan: "trial",
      rightsExpireNoLaterThan: later(2),
    });
  });

  it("requires an assigned seat for organizations", () => {
    expect(decide([right({
      accountType: "ORGANIZATION",
      accountOwnerId: "org-admin",
      seatAssigned: true,
    })])).toMatchObject({ status: "eligible" });
    expect(decide([right({
      accountType: "ORGANIZATION",
      seatAssigned: false,
    })])).toMatchObject({ status: "denied" });
  });

  it("rejects unknown rights even if another product has a valid license", () => {
    expect(decide([right({ rightSourceVerified: false })])).toMatchObject({
      status: "denied",
    });
  });

  deny({ entitlementStatus: "REVOKED" }, "refuses refunded or revoked entitlements");
  deny({ entitlementValidFrom: later(1) }, "refuses future-dated grants");
  deny({ entitlementValidUntil: now }, "refuses grant expiration at the exclusive boundary");
  deny({ licenseStatus: "SUSPENDED" }, "refuses suspended licenses");
  deny({ licenseStatus: "REVOKED" }, "refuses revoked licenses");
  deny({ licenseExpiresAt: now }, "refuses license expiration at the exclusive boundary");
  deny({ accountLifecycleState: "CLOSED" }, "refuses closed customer accounts");
  deny({ accountLifecycleState: "SUSPENDED" }, "refuses suspended customer accounts");
  deny({ accountOwnerId: "other-user" }, "refuses an individual license owned by another user");
  deny({ accountType: "ANONYMOUS" }, "refuses unknown account type");
  deny({ licenseMaxSeats: 0 }, "refuses zero-seat licenses");
  deny({ purchasePlanType: null }, "never assumes an unknown perpetual plan");
  deny({ purchasePlanType: "MONTHLY" }, "never infers active subscription from a plan label");
  deny({
    subscriptionId: "sub-1",
    subscriptionStatus: "PAST_DUE",
    subscriptionPeriodStart: earlier(1),
    subscriptionPeriodEnd: later(4),
  }, "refuses past-due subscriptions");
  deny({
    subscriptionId: "sub-1",
    subscriptionStatus: "ACTIVE",
    subscriptionPeriodStart: later(1),
    subscriptionPeriodEnd: later(4),
  }, "refuses future subscription periods");
  deny({
    subscriptionId: "sub-1",
    subscriptionStatus: "ACTIVE",
    subscriptionPeriodStart: earlier(2),
    subscriptionPeriodEnd: now,
  }, "refuses expired paid periods");
  deny({
    trialId: "trial-1",
    trialStartsAt: earlier(1),
    trialEndsAt: later(1),
    trialRevokedAt: earlier(1),
  }, "refuses revoked trial even if license active");
  deny({
    trialId: "trial-1",
    trialStartsAt: later(1),
    trialEndsAt: later(2),
  }, "refuses trial before its effective start");
  deny({
    trialId: "trial-1",
    trialStartsAt: earlier(1),
    trialEndsAt: now,
  }, "refuses trial end at the hard boundary");
  deny({
    trialId: "trial-1",
    trialStartsAt: earlier(1),
    trialEndsAt: later(1),
    subscriptionId: "sub-1",
  }, "refuses ambiguous trial + subscription right");

  it("cannot bypass a missing or unpublished product using a valid license", () => {
    for (const patch of [
      { productExists: false },
      { productEntitled: false },
      { productInstallable: false },
      { productExecutionType: null },
      { productExecutionType: "REMOTE" },
    ]) {
      expect(decide([right()], patch)).toMatchObject({
        status: "denied",
        reason: "NOT_ENTITLED",
      });
    }
  });

  it("allows OPEN or USE only, never an unrecognized action", () => {
    expect(decide([right()], { action: "USE" })).toMatchObject({
      status: "eligible",
      action: "USE",
    });
    expect(decide([right()], { action: "DELETE" as "OPEN" })).toEqual({
      status: "denied",
      reason: "INVALID_CONTEXT",
    });
  });

  it("never fabricates JWS expiry for perpetual grants", () => {
    expect(decide([right({
      entitlementValidUntil: null,
      licenseExpiresAt: null,
    })])).toMatchObject({
      status: "eligible",
      plan: "perpetual",
      rightsExpireNoLaterThan: null,
    });
  });

  it("selects the longest independently proven right, never a revoked shortcut", () => {
    expect(decide([
      right({ licenseId: "early", entitlementId: "early", licenseExpiresAt: later(3) }),
      right({ licenseId: "rejected", entitlementId: "bad", entitlementStatus: "REVOKED", licenseExpiresAt: null }),
      right({ licenseId: "long", entitlementId: "long", licenseExpiresAt: later(10) }),
    ])).toMatchObject({
      status: "eligible",
      licenseId: "long",
      rightsExpireNoLaterThan: later(10),
    });
  });

  it("keeps server-token identity ahead of all rights queries and ties rights to source records", () => {
    const source = readFileSync("apps/web/agent-sessions/product-lease-eligibility.ts", "utf8");
    expect(source).toContain("authenticateAgentAccessToken");
    expect(source).toContain("readAgentSoftwareCatalog");
    expect(source.indexOf("authenticateAgentAccessToken(tx")).toBeLessThan(source.indexOf("readAgentSoftwareCatalog(tx"));
    expect(source.indexOf("readAgentSoftwareCatalog(tx")).toBeLessThan(source.indexOf("tx.$queryRaw"));
    expect(source).toContain("session.accountId");
    expect(source).toContain("session.userId");
    expect(source).toContain('FROM "Entitlement" e');
    expect(source).toContain('JOIN "License" l');
    expect(source).toContain('JOIN "OrderItem" item');
    expect(source).toContain('item."orderId" = l."orderId"');
    expect(source).toContain('item."productId" = p."id"');
    expect(source).toContain('sourceOrder."status" = \'PAID\'');
    expect(source).toContain('claim."productId" = p."id"');
    expect(source).toContain('s."accountId" = ca."id"');
    expect(source).toContain('s."productId" = p."id"');
    expect(source).toContain('tg."accountId" = ca."id"');
    expect(source).toContain('tg."productId" = p."id"');
    expect(source).toContain('pp."editionId" = licenseEdition."id"');
    expect(source).toContain('claim."claimedToAccountId" = ca."id"');
    expect(source).toContain('claim."orderItemId" = l."orderItemId"');
    expect(source).toContain('e."sourceReference" = (');
    expect(source).toContain('LEFT JOIN "Subscription" s');
    expect(source).toContain('LEFT JOIN "TrialGrant" tg');
    expect(source).not.toContain("createPrivateKey");
    expect(source).not.toContain("issueAccountProductLeaseJws");
    expect(source).not.toContain("licenseKey");
    expect(source).not.toContain("customer_account_id");
  });
});
