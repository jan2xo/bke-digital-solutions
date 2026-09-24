import { describe, expect, it } from "vitest";
import {
  decideSelfPurchaseContinuation,
  type SelfPurchaseLicenseFact,
} from "@/apps/web/licensing/self-purchase-continuation-policy";

function license(
  purchasePlanId: string | null,
  subscription:
    | {
        id: string;
        status: "PENDING" | "ACTIVE" | "PAST_DUE" | "EXPIRED" | "CANCELLED";
        purchasePlanId: string | null;
      }
    | null,
): SelfPurchaseLicenseFact {
  return { purchasePlanId, subscription };
}

describe("self-purchase licensing continuation", () => {
  it("buys a new license when there is no current license", () => {
    expect(decideSelfPurchaseContinuation("plan-1", [])).toEqual({
      mode: "NEW",
    });
  });

  it("extends the existing same-plan active subscription", () => {
    expect(
      decideSelfPurchaseContinuation("plan-1", [
        license("plan-1", {
          id: "subscription-1",
          status: "ACTIVE",
          purchasePlanId: "plan-1",
        }),
      ]),
    ).toEqual({
      mode: "RENEW",
      subscriptionId: "subscription-1",
    });
  });

  it("can recover a same-plan past-due subscription instead of issuing another license", () => {
    expect(
      decideSelfPurchaseContinuation("plan-1", [
        license("plan-1", {
          id: "subscription-1",
          status: "PAST_DUE",
          purchasePlanId: "plan-1",
        }),
      ]),
    ).toEqual({
      mode: "RENEW",
      subscriptionId: "subscription-1",
    });
  });

  it("does not guess renewal for a legacy subscription without a matching plan identity", () => {
    expect(
      decideSelfPurchaseContinuation("plan-1", [
        license("plan-1", {
          id: "subscription-legacy",
          status: "ACTIVE",
          purchasePlanId: null,
        }),
      ]),
    ).toEqual({
      mode: "CONFLICT",
      reason: "ALREADY_OWNED",
    });
  });

  it("does not sell the same non-renewable license twice", () => {
    expect(
      decideSelfPurchaseContinuation("plan-1", [
        license("plan-1", null),
      ]),
    ).toEqual({
      mode: "CONFLICT",
      reason: "ALREADY_OWNED",
    });
  });

  it("does not revive a cancelled same-plan subscription by guessing", () => {
    expect(
      decideSelfPurchaseContinuation("plan-1", [
        license("plan-1", {
          id: "subscription-1",
          status: "CANCELLED",
          purchasePlanId: "plan-1",
        }),
      ]),
    ).toEqual({
      mode: "CONFLICT",
      reason: "ALREADY_OWNED",
    });
  });

  it("blocks implicit plan switching while a current license exists", () => {
    expect(
      decideSelfPurchaseContinuation("plan-2", [
        license("plan-1", {
          id: "subscription-1",
          status: "ACTIVE",
          purchasePlanId: "plan-1",
        }),
      ]),
    ).toEqual({
      mode: "CONFLICT",
      reason: "PLAN_CHANGE_REQUIRED",
    });
  });

  it("prefers a renewable same-plan license when stale duplicates already exist", () => {
    expect(
      decideSelfPurchaseContinuation("plan-1", [
        license("plan-1", {
          id: "subscription-cancelled",
          status: "CANCELLED",
          purchasePlanId: "plan-1",
        }),
        license("plan-1", {
          id: "subscription-active",
          status: "ACTIVE",
          purchasePlanId: "plan-1",
        }),
      ]),
    ).toEqual({
      mode: "RENEW",
      subscriptionId: "subscription-active",
    });
  });
});
