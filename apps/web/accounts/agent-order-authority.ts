import "server-only";

import {
  ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID,
  type AccountsAccountAccessCapability,
  type AccountsCapability,
} from "@bke/accounts/contracts/account-access.contract";
import { db } from "@/platform/host/db";
import { getV2WebApplication } from "@/apps/web/runtime";
import { paymentProvider } from "@/apps/web/payments/compatibility-provider";
import { randomToken } from "@/platform/host/security/crypto";

type OrderAuthorization =
  | { readonly status: "authorized" }
  | {
      readonly status:
        | "account_forbidden"
        | "account_not_active"
        | "failed";
    };

async function authorizeOrderAction(input: {
  principalId: string;
  accountId: string;
  capability: AccountsCapability;
}): Promise<OrderAuthorization> {
  try {
    const application = await getV2WebApplication();
    const accountAccess =
      application.get<AccountsAccountAccessCapability>(
        ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID,
      );
    const access = await accountAccess.authorize({
      principalId: input.principalId,
      accountId: input.accountId,
      requiredCapability: input.capability,
    });

    if (access.status === "REJECTED") {
      return { status: "account_forbidden" };
    }
    if (access.status === "FAILED") {
      return { status: "failed" };
    }
    if (access.account.lifecycleState !== "ACTIVE") {
      return { status: "account_not_active" };
    }

    return { status: "authorized" };
  } catch {
    return { status: "failed" };
  }
}

export type AgentPendingOrderContinueResult =
  | {
      readonly status: "continued";
      readonly checkoutUrl: string;
    }
  | {
      readonly status:
        | "order_not_found"
        | "account_forbidden"
        | "account_not_active"
        | "checkout_creation_in_progress"
        | "failed";
    };

export async function continueAgentPendingOrder(input: {
  principalId: string;
  accountId: string;
  orderId: string;
}): Promise<AgentPendingOrderContinueResult> {
  const authorization = await authorizeOrderAction({
    principalId: input.principalId,
    accountId: input.accountId,
    capability: "PURCHASE",
  });
  if (authorization.status !== "authorized") {
    return authorization;
  }

  try {
    const reserved = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`;
      const orderRecord = await tx.order.findFirst({
        where: {
          id: input.orderId,
          accountId: input.accountId,
          status: "PENDING",
        },
      });
      if (!orderRecord) {
        return { status: "order_not_found" as const };
      }

      const account = await tx.customerAccount.findUniqueOrThrow({
        where: { id: input.accountId },
      });
      const items = await tx.orderItem.findMany({
        where: { orderId: orderRecord.id },
        orderBy: { id: "asc" },
      });
      const attempts = await tx.paymentAttempt.findMany({
        where: {
          orderId: orderRecord.id,
          status: { in: ["CREATING", "PENDING"] },
        },
        orderBy: { createdAt: "desc" },
        take: 1,
      });

      const existing = attempts[0];
      if (
        existing?.status === "PENDING" &&
        existing.checkoutUrl
      ) {
        return {
          status: "continued" as const,
          checkoutUrl: existing.checkoutUrl,
        };
      }
      if (
        existing?.status === "CREATING" &&
        existing.createdAt >
          new Date(Date.now() - 5 * 60_000)
      ) {
        return {
          status:
            "checkout_creation_in_progress" as const,
        };
      }
      if (existing) {
        await tx.paymentAttempt.update({
          where: { id: existing.id },
          data: { status: "FAILED" },
        });
      }

      const idempotencyKey = randomToken();
      await tx.paymentAttempt.create({
        data: {
          orderId: orderRecord.id,
          provider: paymentProvider.name,
          idempotencyKey,
          status: "CREATING",
        },
      });

      return {
        status: "create_checkout" as const,
        order: {
          ...orderRecord,
          account,
          items,
        },
        idempotencyKey,
      };
    });

    if (
      reserved.status === "order_not_found" ||
      reserved.status ===
        "checkout_creation_in_progress"
    ) {
      return reserved;
    }
    if (reserved.status === "continued") {
      return reserved;
    }

    const { order, idempotencyKey } = reserved;
    try {
      const checkout =
        await paymentProvider.createCheckout({
          orderId: order.id,
          reference: order.number,
          amountMinor: order.totalMinor,
          currency: order.currency,
          customer: {
            name: order.account.displayName,
            email: order.account.billingEmail,
          },
          idempotencyKey,
          items: order.items.map((item) => ({
            name: `${item.productName}${item.editionName ? ` — ${item.editionName}` : ""}`,
            description:
              item.planName ?? item.priceName,
            amountMinor: item.unitAmountMinor,
            quantity: item.quantity,
          })),
        });

      const attempt = await db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${order.id} FOR UPDATE`;
          const current =
            await tx.order.findFirst({
              where: {
                id: order.id,
                accountId: input.accountId,
              },
              select: { status: true },
            });

          return tx.paymentAttempt.update({
            where: { idempotencyKey },
            data: {
              status:
                current?.status === "PENDING"
                  ? "PENDING"
                  : "CANCELLED",
              externalCheckoutId:
                checkout.externalId,
              checkoutUrl: checkout.checkoutUrl,
            },
          });
        },
      );

      if (attempt.status !== "PENDING") {
        return { status: "order_not_found" };
      }

      return {
        status: "continued",
        checkoutUrl: checkout.checkoutUrl,
      };
    } catch {
      await db.paymentAttempt.updateMany({
        where: {
          idempotencyKey,
          status: "CREATING",
        },
        data: { status: "FAILED" },
      });
      return { status: "failed" };
    }
  } catch {
    return { status: "failed" };
  }
}

export type AgentPendingOrderCancelResult =
  | { readonly status: "cancelled" }
  | {
      readonly status:
        | "order_not_found"
        | "account_forbidden"
        | "account_not_active"
        | "failed";
    };

export async function cancelAgentPendingOrder(input: {
  principalId: string;
  accountId: string;
  orderId: string;
}): Promise<AgentPendingOrderCancelResult> {
  const authorization = await authorizeOrderAction({
    principalId: input.principalId,
    accountId: input.accountId,
    capability: "CANCEL_PENDING_ORDER",
  });
  if (authorization.status !== "authorized") {
    return authorization;
  }

  try {
    return await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`;
        const order = await tx.order.findFirst({
          where: {
            id: input.orderId,
            accountId: input.accountId,
            status: "PENDING",
          },
          select: {
            id: true,
            accountId: true,
          },
        });
        if (!order) {
          return {
            status: "order_not_found" as const,
          };
        }

        await tx.order.update({
          where: { id: order.id },
          data: { status: "CANCELLED" },
        });
        await tx.paymentAttempt.updateMany({
          where: {
            orderId: order.id,
            status: { in: ["CREATING", "PENDING"] },
          },
          data: { status: "CANCELLED" },
        });
        await tx.$executeRaw`
          UPDATE "PaymentCheckoutAttempt"
             SET "status" = 'CANCELLED', "updatedAt" = NOW()
           WHERE "commercialReference" = ${order.id}
             AND "status" IN ('CREATING', 'PENDING')
        `;
        await tx.auditLog.create({
          data: {
            actorId: input.principalId,
            accountId: input.accountId,
            action: "ORDER_CANCELLED",
            targetType: "Order",
            targetId: order.id,
          },
        });

        return { status: "cancelled" as const };
      },
      { isolationLevel: "Serializable" },
    );
  } catch {
    return { status: "failed" };
  }
}
