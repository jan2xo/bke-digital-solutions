import "server-only";

import {
  ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID,
  type AccountsAccountAccessCapability,
} from "@bke/accounts/contracts/account-access.contract";
import { roleHasAccountsCapability } from "@bke/accounts/logic/account-authorization-policy";
import { db } from "@/platform/host/db";
import { getV2WebApplication } from "@/apps/web/runtime";

const LIST_LIMIT = 50;

export type AgentAccountBillingHistory =
  | {
      readonly status: "ready";
      readonly account: {
        readonly type: "INDIVIDUAL" | "ORGANIZATION";
        readonly displayName: string;
        readonly lifecycleState: string;
        readonly role: string;
      };
      readonly permissions: {
        readonly viewInvoices: boolean;
        readonly viewPayments: boolean;
      };
      readonly invoices: readonly {
        readonly number: string;
        readonly status: string;
        readonly orderNumber: string;
        readonly currency: string;
        readonly subtotalMinor: number;
        readonly taxMinor: number;
        readonly totalMinor: number;
        readonly issuedAt: Date | null;
        readonly createdAt: Date;
        readonly lines: readonly {
          readonly description: string;
          readonly quantity: number;
          readonly unitAmountMinor: number;
          readonly totalMinor: number;
        }[];
      }[];
      readonly payments: readonly {
        readonly orderNumber: string;
        readonly status: string;
        readonly amountMinor: number;
        readonly currency: string;
        readonly paidAt: Date | null;
        readonly createdAt: Date;
      }[];
    }
  | { readonly status: "forbidden" }
  | { readonly status: "failed" };

export async function getAgentAccountBillingHistory(input: {
  principalId: string;
  accountId: string;
}): Promise<AgentAccountBillingHistory> {
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

  const viewInvoices = roleHasAccountsCapability(
    access.effectiveRole,
    "VIEW_INVOICES",
  );
  const viewPayments = roleHasAccountsCapability(
    access.effectiveRole,
    "VIEW_PAYMENTS",
  );

  const [invoices, payments] = await Promise.all([
    viewInvoices
      ? db.invoice.findMany({
          where: { order: { accountId: input.accountId } },
          orderBy: { createdAt: "desc" },
          take: LIST_LIMIT,
          select: {
            number: true,
            status: true,
            currency: true,
            subtotalMinor: true,
            taxMinor: true,
            totalMinor: true,
            issuedAt: true,
            createdAt: true,
            order: { select: { number: true } },
            lines: {
              orderBy: { id: "asc" },
              select: {
                description: true,
                quantity: true,
                unitAmountMinor: true,
                totalMinor: true,
              },
            },
          },
        })
      : Promise.resolve([]),
    viewPayments
      ? db.payment.findMany({
          where: { order: { accountId: input.accountId } },
          orderBy: { createdAt: "desc" },
          take: LIST_LIMIT,
          select: {
            status: true,
            amountMinor: true,
            currency: true,
            paidAt: true,
            createdAt: true,
            order: { select: { number: true } },
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
      viewInvoices,
      viewPayments,
    },
    invoices: invoices.map((invoice) => ({
      number: invoice.number,
      status: invoice.status,
      orderNumber: invoice.order.number,
      currency: invoice.currency,
      subtotalMinor: invoice.subtotalMinor,
      taxMinor: invoice.taxMinor,
      totalMinor: invoice.totalMinor,
      issuedAt: invoice.issuedAt,
      createdAt: invoice.createdAt,
      lines: invoice.lines.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unitAmountMinor: line.unitAmountMinor,
        totalMinor: line.totalMinor,
      })),
    })),
    payments: payments.map((payment) => ({
      orderNumber: payment.order.number,
      status: payment.status,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      paidAt: payment.paidAt,
      createdAt: payment.createdAt,
    })),
  };
}
