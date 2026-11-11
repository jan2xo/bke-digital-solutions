import {
  ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID,
  type AccountsAccountAccessCapability,
} from "@bke/accounts/contracts/account-access.contract";
import { roleHasAccountsCapability } from "@bke/accounts/logic/account-authorization-policy";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/apps/web/auth/session";
import { db } from "@/platform/host/db";
import { CustomerLicenseCard } from "@/components/customer-license-card";
import { PendingOrderActions } from "@/components/pending-order-actions";
import { requireLegalClearance } from "@/apps/web/legal/clearance";
import { publishedLegalDocuments } from "@/apps/web/legal/service";
import { SUBSCRIPTION_LEGAL_TYPES, CHECKOUT_LEGAL_TYPES } from "@bke/legal/logic/document-catalog";
import { SubscriptionRenewButton } from "@/components/subscription-renew-button";
import { getV2WebApplication } from "@/apps/web/runtime";
import { roleHasClaimAccountCapability } from "@/apps/web/accounts/claim-code-authorization";
import { GiftClaimCodes } from "@/components/gift-claim-codes";
import { AccountNotificationHighlights } from "@/components/account-notification-highlights";
import { listNotificationsForUser } from "@/apps/web/notifications/center";
import { buildMySoftwarePresentation, planTypeLabel } from "@/apps/web/accounts/my-software-presentation";

export default async function AccountPage({ params }: { params: Promise<{ accountId: string }> }) {
  const user = await requireUser().catch(() => redirect("/login"));
  const { accountId } = await params;
  await requireLegalClearance(user.id, `/dashboard/accounts/${accountId}`);
  const access = await (async () => {
    const application = await getV2WebApplication();
    const accountAccess = application.get<AccountsAccountAccessCapability>(
      ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID,
    );
    const result = await accountAccess.authorize({ principalId: user.id, accountId });
    if (result.status !== "AUTHORIZED") throw new Error(result.code);
    return result;
  })().catch(() => redirect("/dashboard"));
  const account = { ...access.account, effectiveRole: access.effectiveRole };
  const canViewOrders = roleHasAccountsCapability(account.effectiveRole, "VIEW_ORDERS");
  const canViewLicenses = roleHasAccountsCapability(account.effectiveRole, "VIEW_LICENSES");
  const canViewSubscriptions = roleHasAccountsCapability(account.effectiveRole, "VIEW_SUBSCRIPTIONS");
  const canAssignLicenses = roleHasAccountsCapability(account.effectiveRole, "ASSIGN_LICENSE");
  const canManageDevices = roleHasAccountsCapability(account.effectiveRole, "DEACTIVATE_DEVICE");
  const canRenewSubscriptions = canViewSubscriptions && (account.effectiveRole === "OWNER" || account.effectiveRole === "BILLING") && account.lifecycleState === "ACTIVE";
  const canManageClaimCodes = roleHasClaimAccountCapability(account.effectiveRole, "MANAGE_CLAIM_CODES");
  const [orders, licenses, subscriptions, trials, renewalLegal, giftClaims] = await Promise.all([
    canViewOrders ? db.order.findMany({ where: { accountId }, include: { invoice: true, payments: true, items: true, attempts: { select: { status: true, checkoutUrl: true }, orderBy: { createdAt: "desc" }, take: 1 } }, orderBy: { createdAt: "desc" }, take: 50 }) : [],
    db.license.findMany({ where: { accountId, ...(canViewLicenses ? {} : { assignments: { some: { userId: user.id } } }) }, include: { edition: true, purchasePlan: true, product: true, trialGrant: { select: { id: true } }, _count: { select: { assignments: true } }, activations: { orderBy: { activatedAt: "desc" } } }, orderBy: { createdAt: "desc" }, take: 50 }),
    canViewSubscriptions ? db.subscription.findMany({ where: { accountId }, include: { product: true, edition: true, purchasePlan: true }, orderBy: { createdAt: "desc" }, take: 50 }) : [],
    canViewLicenses ? db.trialGrant.findMany({ where: { accountId }, include: { product: true, edition: true, license: true }, orderBy: { createdAt: "desc" }, take: 50 }) : [],
    publishedLegalDocuments([...CHECKOUT_LEGAL_TYPES, ...SUBSCRIPTION_LEGAL_TYPES]),
    canManageClaimCodes ? db.$queryRaw<Array<{
      id: string;
      orderNumber: string;
      productName: string;
      editionName: string | null;
      planName: string | null;
      lastFour: string;
      status: "AVAILABLE" | "CLAIMED" | "REVOKED" | "EXPIRED";
      createdAt: Date;
      expiresAt: Date | null;
    }>>`
      SELECT cc."id",
             o."number" AS "orderNumber",
             oi."productName",
             oi."editionName",
             oi."planName",
             cc."codeLastFour" AS "lastFour",
             cc."status"::text AS "status",
             cc."createdAt",
             cc."expiresAt"
        FROM "ClaimCode" cc
        JOIN "Order" o ON o."id" = cc."orderId"
        JOIN "OrderItem" oi ON oi."id" = cc."orderItemId"
       WHERE cc."purchaserAccountId" = ${accountId}
       ORDER BY cc."createdAt" DESC
       LIMIT 100
    ` : Promise.resolve([]),
  ]);
  const software = buildMySoftwarePresentation({
    // Keep trials under Product trials for account managers; assigned-only members
    // may still see the assigned license in My Software.
    licenses: licenses.filter((license) => !canViewLicenses || !license.trialGrant).map((license) => ({
      id: license.id,
      productName: license.product.name,
      editionName: license.edition?.name ?? null,
      planType: license.purchasePlan?.type ?? null,
      status: license.status,
      subscriptionId: license.subscriptionId,
      expiresAt: license.expiresAt?.toISOString() ?? null,
      maxSeats: license.maxSeats,
      assignedSeats: license._count.assignments,
      maxDevices: license.maxSeats * license.maxDevicesPerSeat,
      activeDevices: license.activations.filter((activation) => activation.active).length,
    })),
    subscriptions: subscriptions.map((subscription) => ({
      id: subscription.id,
      productName: subscription.product.name,
      editionName: subscription.edition?.name ?? null,
      planType: subscription.purchasePlan?.type ?? null,
      status: subscription.status,
      seats: subscription.seats,
      currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
    })),
    canViewSubscriptions,
  });
  const licensesById = new Map(licenses.map((license) => [license.id, license] as const));
  const renewalDocuments = renewalLegal.map((document) => ({
    versionId: document.currentPublishedVersionId!,
    title: document.title,
    slug: document.slug,
  }));
  // Account visibility was verified above; notifications are filtered again by account before display.
  const recentNotifications = await listNotificationsForUser({ userId: user.id, role: user.role, limit: 100 });
  return <section className="shell py-14"><p className="account-role-eyebrow">{account.type} · {account.effectiveRole}</p><h1 className="mt-2 text-4xl font-black">{account.displayName}</h1>{account.lifecycleState !== "ACTIVE" && <p className="mt-3 rounded border border-amber-400 bg-amber-50 p-3 font-bold text-amber-900">This account is {account.lifecycleState.toLowerCase()}. New purchases, renewals, trials, activations, and BKE-managed installs are disabled.</p>}<AccountNotificationHighlights accountId={accountId} items={recentNotifications}/><div className="mt-10 grid gap-8">
    <section aria-label="My Software">
      <div className="mb-4">
        <h2 className="account-section-heading text-2xl font-black">My Software</h2>
        <p className="mt-2 text-sm text-slate-400">Your account-bound BKE software and managed access.</p>
      </div>
      {software.cards.length
        ? <div className="grid gap-5 lg:grid-cols-2">{software.cards.map((item) => {
            const original = licensesById.get(item.id)!;
            return <CustomerLicenseCard
              key={item.id}
              license={{
                id: item.id,
                productName: item.productName,
                editionName: item.editionName,
                planName: planTypeLabel(item.planType ?? item.subscription?.planType ?? null),
                status: item.status,
                subscriptionStatus: item.subscription?.status ?? null,
                accountLifecycle: account.lifecycleState,
                periodThrough: item.periodThrough,
                activeDevices: item.activeDevices,
                maxDevices: item.maxDevices,
                maxSeats: item.maxSeats,
                assignedSeats: item.assignedSeats,
                activations: original.activations.map((activation) => ({ id: activation.id, label: activation.label, active: activation.active })),
                canManageDevices: canManageDevices && account.lifecycleState === "ACTIVE",
                manageSeatsHref: canAssignLicenses && account.lifecycleState === "ACTIVE" && item.status === "ACTIVE"
                  ? `/dashboard/accounts/${accountId}/licenses/${item.id}/seats`
                  : null,
              }}
              renewalAction={canRenewSubscriptions && item.showRenewal && item.subscription?.status === "ACTIVE"
                ? <SubscriptionRenewButton subscriptionId={item.subscription.id} documents={renewalDocuments}/>
                : null}
            />;
          })}</div>
        : <div className="card p-5 text-sm text-slate-300">
            No owned or assigned software in this account yet. <Link className="font-bold text-[#ffd15a] underline" href="/products">Browse BKE software</Link>.
          </div>}
    </section>
   {giftClaims.length > 0 && <GiftClaimCodes
      customerAccountId={accountId}
      claims={giftClaims.map((claim) => ({
        id: claim.id,
        orderNumber: claim.orderNumber,
        productName: claim.productName,
        editionName: claim.editionName,
        planName: claim.planName,
        lastFour: claim.lastFour,
        status: claim.status,
        createdAt: claim.createdAt.toISOString(),
        expiresAt: claim.expiresAt?.toISOString() ?? null,
      }))}
    />}
   <section><h2 className="account-section-heading mb-3 text-2xl font-black">Product trials</h2>{trials.length ? <div className="grid gap-3">{trials.map((trial) => { const state = trial.revokedAt ? "REVOKED" : trial.license.status; return <article className="card p-5" key={trial.id}><div className="flex flex-wrap justify-between gap-3"><div><b>{trial.product.name} — {trial.edition.name}</b><p className="mt-1 text-sm text-[#a8b5c4]">7-day trial · access through {trial.graceEndsAt.toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</p></div><span className="font-bold">{state}</span></div></article>; })}</div> : <p className="account-trials-empty">No active trials.</p>}</section>
    <section className={`grid gap-6 ${canViewOrders && software.unlinkedSubscriptions.length ? "lg:grid-cols-2" : ""}`}>{canViewOrders && <Panel title="Order history">{orders.length ? orders.map((order) => <div className="rounded-lg border border-slate-600 bg-slate-800 p-3 text-sm" key={order.id}><div className="flex justify-between"><b>{order.number}</b><span>{order.status}</span></div><p className="mt-1 text-[#a8b5c4]">{money(order.totalMinor, order.currency)} · {order.items.map((item) => `${item.productName}${item.editionName ? ` — ${item.editionName} (${item.planName})` : ""}`).join(", ")}</p>{order.invoice && <Link className="mt-2 inline-block font-bold text-sky-300 underline underline-offset-2" href={`/dashboard/invoices/${order.invoice.id}`}>View invoice</Link>}{order.status === "PENDING" && account.lifecycleState === "ACTIVE" && <PendingOrderActions orderId={order.id} canContinue={order.attempts[0]?.status === "PENDING" && Boolean(order.attempts[0]?.checkoutUrl)}/>}</div>) : <Empty/>}</Panel>}{canViewSubscriptions && software.unlinkedSubscriptions.length > 0 && <Panel title="Subscriptions">
        {software.unlinkedSubscriptions.map((subscription) =>
          <article className="rounded-lg border border-slate-600 bg-slate-800 p-4 text-sm" key={subscription.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <b className="text-white">{subscription.productName}{subscription.editionName ? ` — ${subscription.editionName}` : ""}</b>
              <span className="font-bold text-slate-200">{subscription.status}</span>
            </div>
            <p className="mt-2 text-slate-300">{planTypeLabel(subscription.planType)} · {subscription.seats} seats · period through {new Date(subscription.currentPeriodEnd).toLocaleDateString("en-PH", { timeZone: "Asia/Manila" })}</p>
            {canRenewSubscriptions && subscription.status === "ACTIVE" &&
              <SubscriptionRenewButton subscriptionId={subscription.id} documents={renewalDocuments}/>}
          </article>)}
      </Panel>}</section>
  </div></section>;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) { return <section className="card p-6"><h2 className="text-xl font-black">{title}</h2><div className="mt-5 grid gap-3">{children}</div></section>; }
function Empty() { return <p className="text-sm text-[#a8b5c4]">Nothing here yet.</p>; }
function money(minor: number, currency: string) { return new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(minor / 100); }
