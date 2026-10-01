import { describe, expect, it } from "vitest";
import { db } from "@/platform/host/db";
import { getAgentAccountPurchasesOverview } from "@/apps/web/accounts/agent-account-purchases-overview";
import {
  issueAgentOrderCancelHandle,
  issueAgentOrderContinueHandle,
  resolveAgentOrderCancelHandle,
  resolveAgentOrderContinueHandle,
} from "@/apps/web/accounts/agent-order-management";
import {
  cancelAgentPendingOrder,
  continueAgentPendingOrder,
} from "@/apps/web/accounts/agent-order-authority";

describe("Agent-session pending order management", () => {
  it("keeps pending-order authority selected-account scoped, permission gated, idempotent on checkout reuse, and auditable on cancellation", async () => {
    const suffix = `${Date.now().toString(36)}-${process.pid}-${Math.random().toString(36).slice(2)}`;

    const makeUser = (label: string) =>
      db.user.create({
        data: {
          email: `${label}-${suffix}@bke.test`,
          name: label,
          emailVerified: new Date(),
        },
      });

    const owner = await makeUser("order-owner");
    const billing = await makeUser("order-billing");
    const licenseManager = await makeUser(
      "order-license-manager",
    );
    const member = await makeUser("order-member");
    const outsider = await makeUser("order-outsider");

    const organization = await db.customerAccount.create({
      data: {
        type: "ORGANIZATION",
        displayName: "Order Certification Organization",
        ownerId: owner.id,
        billingEmail: owner.email,
        organization: {
          create: {
            legalName:
              "Order Certification Organization Legal",
          },
        },
        memberships: {
          create: [
            { userId: billing.id, role: "BILLING" },
            {
              userId: licenseManager.id,
              role: "LICENSE_MANAGER",
            },
            { userId: member.id, role: "MEMBER" },
          ],
        },
      },
    });

    const otherAccount = await db.customerAccount.create({
      data: {
        type: "INDIVIDUAL",
        displayName: "Order Other Account",
        ownerId: outsider.id,
        billingEmail: outsider.email,
      },
    });

    const product = await db.product.create({
      data: {
        slug: `order-cert-${suffix}`,
        productId: `bke-order-cert-${suffix}`,
        name: "Order Certification Product",
        summary: "Certification summary",
        description: "Certification description",
        type: "SOFTWARE",
        publishedAt: new Date(),
        editions: {
          create: {
            slug: "pro",
            name: "Pro",
            maxUsers: 1,
            maxDevicesPerUser: 1,
            purchasePlans: {
              create: {
                type: "MONTHLY",
                currency: "PHP",
                amountMinor: 125000,
                renewalBehavior:
                  "CUSTOMER_AUTHORIZED",
              },
            },
          },
        },
      },
      include: {
        editions: {
          include: { purchasePlans: true },
        },
      },
    });

    const edition = product.editions[0]!;
    const plan = edition.purchasePlans[0]!;

    const createPendingOrder = (label: string) =>
      db.order.create({
        data: {
          number: `ORD-${label}-${suffix}`,
          accountId: organization.id,
          status: "PENDING",
          currency: "PHP",
          subtotalMinor: 125000,
          taxMinor: 0,
          totalMinor: 125000,
          billingSnapshot: { certification: true },
          items: {
            create: {
              productId: product.id,
              priceId: plan.id,
              policyId: edition.id,
              productName: product.name,
              priceName: "Monthly",
              quantity: 1,
              unitAmountMinor: 125000,
              totalMinor: 125000,
              billingType: "SUBSCRIPTION",
              policySnapshot: { certification: true },
              editionId: edition.id,
              purchasePlanId: plan.id,
              editionName: edition.name,
              planName: "Monthly",
              planType: "MONTHLY",
              intervalUnit: "MONTH",
              intervalCount: 1,
              renewalBehavior:
                "CUSTOMER_AUTHORIZED",
            },
          },
        },
      });

    const order = await createPendingOrder("PRIMARY");
    const inactiveAccountOrder =
      await createPendingOrder("INACTIVE");

    try {
      const ownerOverview =
        await getAgentAccountPurchasesOverview({
          principalId: owner.id,
          accountId: organization.id,
        });
      expect(ownerOverview.status).toBe("ready");
      if (ownerOverview.status !== "ready") {
        throw new Error("owner purchases overview missing");
      }
      expect(ownerOverview.permissions).toMatchObject({
        viewOrders: true,
        continuePendingOrders: true,
        cancelPendingOrders: true,
      });
      const projected = ownerOverview.orders.find(
        (candidate) => candidate.number === order.number,
      );
      expect(projected).toBeDefined();
      expect(projected?.continueHandle).toMatch(
        /^bke-order-continue-v1_[0-9a-f]{64}$/,
      );
      expect(projected?.cancelHandle).toMatch(
        /^bke-order-cancel-v1_[0-9a-f]{64}$/,
      );
      expect(JSON.stringify(projected)).not.toContain(
        order.id,
      );

      const billingOverview =
        await getAgentAccountPurchasesOverview({
          principalId: billing.id,
          accountId: organization.id,
        });
      expect(billingOverview.status).toBe("ready");
      if (billingOverview.status === "ready") {
        expect(billingOverview.permissions).toMatchObject({
          continuePendingOrders: true,
          cancelPendingOrders: true,
        });
      }

      const licenseManagerOverview =
        await getAgentAccountPurchasesOverview({
          principalId: licenseManager.id,
          accountId: organization.id,
        });
      expect(licenseManagerOverview.status).toBe("ready");
      if (licenseManagerOverview.status === "ready") {
        expect(
          licenseManagerOverview.permissions,
        ).toMatchObject({
          viewOrders: false,
          continuePendingOrders: false,
          cancelPendingOrders: false,
        });
        expect(licenseManagerOverview.orders).toHaveLength(0);
      }

      const memberOverview =
        await getAgentAccountPurchasesOverview({
          principalId: member.id,
          accountId: organization.id,
        });
      expect(memberOverview.status).toBe("ready");
      if (memberOverview.status === "ready") {
        expect(memberOverview.permissions).toMatchObject({
          viewOrders: false,
          continuePendingOrders: false,
          cancelPendingOrders: false,
        });
        expect(memberOverview.orders).toHaveLength(0);
      }

      const continueHandle = issueAgentOrderContinueHandle(
        organization.id,
        order.id,
        order.createdAt,
      );
      const cancelHandle = issueAgentOrderCancelHandle(
        organization.id,
        order.id,
        order.createdAt,
      );

      expect(continueHandle).not.toContain(order.id);
      expect(cancelHandle).not.toContain(order.id);
      expect(
        await resolveAgentOrderContinueHandle({
          accountId: organization.id,
          handle: continueHandle,
        }),
      ).toBe(order.id);
      expect(
        await resolveAgentOrderContinueHandle({
          accountId: otherAccount.id,
          handle: continueHandle,
        }),
      ).toBeNull();
      expect(
        await resolveAgentOrderCancelHandle({
          accountId: organization.id,
          handle: cancelHandle,
        }),
      ).toBe(order.id);
      expect(
        await resolveAgentOrderCancelHandle({
          accountId: otherAccount.id,
          handle: cancelHandle,
        }),
      ).toBeNull();

      await expect(
        continueAgentPendingOrder({
          principalId: member.id,
          accountId: organization.id,
          orderId: order.id,
        }),
      ).resolves.toEqual({
        status: "account_forbidden",
      });
      await expect(
        cancelAgentPendingOrder({
          principalId: member.id,
          accountId: organization.id,
          orderId: order.id,
        }),
      ).resolves.toEqual({
        status: "account_forbidden",
      });

      const continued =
        await continueAgentPendingOrder({
          principalId: billing.id,
          accountId: organization.id,
          orderId: order.id,
        });
      expect(continued.status).toBe("continued");
      if (continued.status !== "continued") {
        throw new Error(
          "pending order continuation failed",
        );
      }

      const checkoutUrl = new URL(continued.checkoutUrl);
      expect(checkoutUrl.origin).toBe(
        new URL(process.env.APP_URL!).origin,
      );
      expect(checkoutUrl.pathname).toBe(
        "/checkout/success",
      );

      const firstAttempts =
        await db.paymentAttempt.findMany({
          where: { orderId: order.id },
        });
      expect(firstAttempts).toHaveLength(1);
      expect(firstAttempts[0]!.status).toBe("PENDING");
      expect(firstAttempts[0]!.checkoutUrl).toBe(
        continued.checkoutUrl,
      );

      await expect(
        continueAgentPendingOrder({
          principalId: owner.id,
          accountId: organization.id,
          orderId: order.id,
        }),
      ).resolves.toEqual(continued);
      expect(
        await db.paymentAttempt.count({
          where: { orderId: order.id },
        }),
      ).toBe(1);

      await expect(
        cancelAgentPendingOrder({
          principalId: billing.id,
          accountId: organization.id,
          orderId: order.id,
        }),
      ).resolves.toEqual({ status: "cancelled" });

      const persistedOrder =
        await db.order.findUniqueOrThrow({
          where: { id: order.id },
        });
      expect(persistedOrder.status).toBe("CANCELLED");

      const persistedAttempt =
        await db.paymentAttempt.findFirstOrThrow({
          where: { orderId: order.id },
        });
      expect(persistedAttempt.status).toBe(
        "CANCELLED",
      );

      const audit = await db.auditLog.findFirst({
        where: {
          actorId: billing.id,
          accountId: organization.id,
          action: "ORDER_CANCELLED",
          targetType: "Order",
          targetId: order.id,
        },
      });
      expect(audit).not.toBeNull();

      expect(
        await resolveAgentOrderContinueHandle({
          accountId: organization.id,
          handle: continueHandle,
        }),
      ).toBeNull();
      expect(
        await resolveAgentOrderCancelHandle({
          accountId: organization.id,
          handle: cancelHandle,
        }),
      ).toBeNull();

      await expect(
        cancelAgentPendingOrder({
          principalId: owner.id,
          accountId: organization.id,
          orderId: order.id,
        }),
      ).resolves.toEqual({
        status: "order_not_found",
      });

      await db.customerAccount.update({
        where: { id: organization.id },
        data: { lifecycleState: "SUSPENDED" },
      });

      await expect(
        continueAgentPendingOrder({
          principalId: owner.id,
          accountId: organization.id,
          orderId: inactiveAccountOrder.id,
        }),
      ).resolves.toEqual({
        status: "account_not_active",
      });
      await expect(
        cancelAgentPendingOrder({
          principalId: owner.id,
          accountId: organization.id,
          orderId: inactiveAccountOrder.id,
        }),
      ).resolves.toEqual({
        status: "account_not_active",
      });
    } finally {
      await db.auditLog.deleteMany({
        where: { accountId: organization.id },
      });
      await db.paymentAttempt.deleteMany({
        where: {
          orderId: {
            in: [order.id, inactiveAccountOrder.id],
          },
        },
      });
      await db.order.deleteMany({
        where: { accountId: organization.id },
      });
      await db.customerAccount.deleteMany({
        where: {
          id: {
            in: [organization.id, otherAccount.id],
          },
        },
      });
      await db.product.deleteMany({
        where: { id: product.id },
      });
      await db.user.deleteMany({
        where: {
          id: {
            in: [
              owner.id,
              billing.id,
              licenseManager.id,
              member.id,
              outsider.id,
            ],
          },
        },
      });
    }
  });
});
