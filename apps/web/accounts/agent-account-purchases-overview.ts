import "server-only";

import {
  ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID,
  type AccountsAccountAccessCapability,
} from "@bke/accounts/contracts/account-access.contract";
import { roleHasAccountsCapability } from "@bke/accounts/logic/account-authorization-policy";
import { db } from "@/platform/host/db";
import { getV2WebApplication } from "@/apps/web/runtime";
import { issueAgentLicenseSeatManagementHandle } from "@/apps/web/licensing/agent-license-seat-management";
import { issueAgentLicenseDeviceManagementHandle } from "@/apps/web/licensing/agent-license-device-management";
import {
  issueAgentOrderCancelHandle,
  issueAgentOrderContinueHandle,
} from "@/apps/web/accounts/agent-order-management";

const LIST_LIMIT = 50;

export type AgentAccountPurchasesOverview =
  | {
      readonly status: "ready";
      readonly account: {
        readonly type: "INDIVIDUAL" | "ORGANIZATION";
        readonly displayName: string;
        readonly lifecycleState: string;
        readonly role: string;
      };
      readonly permissions: {
        readonly viewOrders: boolean;
        readonly viewSubscriptions: boolean;
        readonly viewAllLicenses: boolean;
        readonly manageLicenseSeats: boolean;
        readonly manageDevices: boolean;
        readonly continuePendingOrders: boolean;
        readonly cancelPendingOrders: boolean;
      };
      readonly licenses: readonly {
        readonly productName: string;
        readonly editionName: string | null;
        readonly planType: "PERPETUAL" | "MONTHLY" | "ANNUAL" | null;
        readonly status: string;
        readonly keyLastFour: string;
        readonly expiresAt: Date | null;
        readonly maxDevices: number;
        readonly activeDevices: number;
        readonly maxSeats: number;
        readonly assignedSeats: number;
        readonly seatManagementHandle: string | null;
        readonly deviceManagementHandle: string | null;
      }[];
      readonly subscriptions: readonly {
        readonly productName: string;
        readonly editionName: string | null;
        readonly planType: "PERPETUAL" | "MONTHLY" | "ANNUAL" | null;
        readonly status: string;
        readonly seats: number;
        readonly currentPeriodEnd: Date;
      }[];
      readonly orders: readonly {
        readonly number: string;
        readonly status: string;
        readonly totalMinor: number;
        readonly currency: string;
        readonly createdAt: Date;
        readonly invoiceAvailable: boolean;
        readonly continueHandle: string | null;
        readonly cancelHandle: string | null;
        readonly items: readonly {
          readonly productName: string;
          readonly editionName: string | null;
          readonly planName: string | null;
        }[];
      }[];
    }
  | { readonly status: "forbidden" }
  | { readonly status: "failed" };

export async function getAgentAccountPurchasesOverview(input: {
  principalId: string;
  accountId: string;
}): Promise<AgentAccountPurchasesOverview> {
  const application = await getV2WebApplication();
  const accountAccess = application.get<AccountsAccountAccessCapability>(
    ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID,
  );
  const access = await accountAccess.authorize({
    principalId: input.principalId,
    accountId: input.accountId,
  });

  if (access.status === "REJECTED") {
    return { status: "forbidden" };
  }
  if (access.status === "FAILED") {
    return { status: "failed" };
  }

  const viewOrders = roleHasAccountsCapability(
    access.effectiveRole,
    "VIEW_ORDERS",
  );
  const viewSubscriptions = roleHasAccountsCapability(
    access.effectiveRole,
    "VIEW_SUBSCRIPTIONS",
  );
  const viewAllLicenses = roleHasAccountsCapability(
    access.effectiveRole,
    "VIEW_LICENSES",
  );
  const manageLicenseSeats = roleHasAccountsCapability(
    access.effectiveRole,
    "ASSIGN_LICENSE",
  );
  const manageDevices = roleHasAccountsCapability(
    access.effectiveRole,
    "DEACTIVATE_DEVICE",
  );
  const continuePendingOrders = roleHasAccountsCapability(
    access.effectiveRole,
    "PURCHASE",
  );
  const cancelPendingOrders = roleHasAccountsCapability(
    access.effectiveRole,
    "CANCEL_PENDING_ORDER",
  );

  const [licenses, subscriptions, orders] = await Promise.all([
    db.license.findMany({
      where: {
        accountId: input.accountId,
        ...(viewAllLicenses
          ? {}
          : {
              assignments: {
                some: { userId: input.principalId },
              },
            }),
      },
      orderBy: { createdAt: "desc" },
      take: LIST_LIMIT,
      select: {
        id: true,
        createdAt: true,
        status: true,
        keyLastFour: true,
        expiresAt: true,
        maxSeats: true,
        maxDevicesPerSeat: true,
        product: { select: { name: true } },
        edition: { select: { name: true } },
        purchasePlan: { select: { type: true } },
        activations: {
          where: { active: true },
          select: { id: true },
        },
        _count: {
          select: { assignments: true },
        },
      },
    }),
    viewSubscriptions
      ? db.subscription.findMany({
          where: { accountId: input.accountId },
          orderBy: { createdAt: "desc" },
          take: LIST_LIMIT,
          select: {
            status: true,
            seats: true,
            currentPeriodEnd: true,
            product: { select: { name: true } },
            edition: { select: { name: true } },
            purchasePlan: { select: { type: true } },
          },
        })
      : Promise.resolve([]),
    viewOrders
      ? db.order.findMany({
          where: { accountId: input.accountId },
          orderBy: { createdAt: "desc" },
          take: LIST_LIMIT,
          select: {
            id: true,
            number: true,
            status: true,
            totalMinor: true,
            currency: true,
            createdAt: true,
            invoice: { select: { id: true } },
            items: {
              select: {
                productName: true,
                editionName: true,
                planName: true,
              },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  return {
    status: "ready",
    account: {
      type: access.account.type,
      displayName: access.account.displayName,
      lifecycleState: access.account.lifecycleState,
      role: access.effectiveRole,
    },
    permissions: {
      viewOrders,
      viewSubscriptions,
      viewAllLicenses,
      manageLicenseSeats,
      manageDevices,
      continuePendingOrders,
      cancelPendingOrders,
    },
    licenses: licenses.map((license) => ({
      productName: license.product.name,
      editionName: license.edition?.name ?? null,
      planType: license.purchasePlan?.type ?? null,
      status: license.status,
      keyLastFour: license.keyLastFour,
      expiresAt: license.expiresAt,
      maxDevices:
        license.maxSeats * license.maxDevicesPerSeat,
      activeDevices: license.activations.length,
      maxSeats: license.maxSeats,
      assignedSeats: license._count.assignments,
      seatManagementHandle:
        manageLicenseSeats &&
        access.account.lifecycleState === "ACTIVE" &&
        license.status === "ACTIVE"
          ? issueAgentLicenseSeatManagementHandle(
              input.accountId,
              license.id,
              license.createdAt,
            )
          : null,
      deviceManagementHandle:
        manageDevices &&
        access.account.lifecycleState === "ACTIVE"
          ? issueAgentLicenseDeviceManagementHandle(
              input.accountId,
              license.id,
              license.createdAt,
            )
          : null,
    })),
    subscriptions: subscriptions.map((subscription) => ({
      productName: subscription.product.name,
      editionName: subscription.edition?.name ?? null,
      planType: subscription.purchasePlan?.type ?? null,
      status: subscription.status,
      seats: subscription.seats,
      currentPeriodEnd: subscription.currentPeriodEnd,
    })),
    orders: orders.map((order) => ({
      number: order.number,
      status: order.status,
      totalMinor: order.totalMinor,
      currency: order.currency,
      createdAt: order.createdAt,
      invoiceAvailable: order.invoice !== null,
      continueHandle:
        continuePendingOrders &&
        access.account.lifecycleState === "ACTIVE" &&
        order.status === "PENDING"
          ? issueAgentOrderContinueHandle(
              input.accountId,
              order.id,
              order.createdAt,
            )
          : null,
      cancelHandle:
        cancelPendingOrders &&
        access.account.lifecycleState === "ACTIVE" &&
        order.status === "PENDING"
          ? issueAgentOrderCancelHandle(
              input.accountId,
              order.id,
              order.createdAt,
            )
          : null,
      items: order.items.map((item) => ({
        productName: item.productName,
        editionName: item.editionName,
        planName: item.planName,
      })),
    })),
  };
}
