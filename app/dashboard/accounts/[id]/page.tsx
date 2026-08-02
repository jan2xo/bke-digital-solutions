import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { requireAccountAccess } from "@/lib/authorization";
import { db } from "@/lib/db";
import { CustomerLicenseCard } from "@/components/customer-license-card";
import { purchasePlanLabel } from "@/lib/pricing";
import { PendingOrderActions } from "@/components/pending-order-actions";
import { requireLegalClearance } from "@/lib/legal/guard";
import { publishedLegalDocuments } from "@/lib/legal/service";
import { SUBSCRIPTION_LEGAL_TYPES, CHECKOUT_LEGAL_TYPES } from "@/lib/legal/constants";
import { SubscriptionRenewButton } from "@/components/subscription-renew-button";

export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => redirect("/login"));
  const { id } = await params;
  await requireLegalClearance(user.id, `/dashboard/accounts/${id}`);
  const account = await requireAccountAccess(user.id, id).catch(() => redirect("/dashboard"));
  const [orders, licenses, subscriptions, trials, renewalLegal] = await Promise.all([
    db.order.findMany({ where: { accountId: id }, include: { invoice: true, payments: true, items: true, attempts: { select: { status: true, checkoutUrl: true }, orderBy: { createdAt: "desc" }, take: 1 } }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.license.findMany({ where: { accountId: id }, include: { edition: true, purchasePlan: true, product: { include: { versions: { where: { active: true, isLatest: true }, include: { artifacts: { where: { active: true } } }, take: 1 } } }, activations: { orderBy: { activatedAt: "desc" } } }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.subscription.findMany({ where: { accountId: id }, include: { product: true, edition: true, purchasePlan: true }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.trialGrant.findMany({ where: { accountId: id }, include: { product: true, edition: true, license: true }, orderBy: { createdAt: "desc" }, take: 50 }),
    publishedLegalDocuments([...CHECKOUT_LEGAL_TYPES, ...SUBSCRIPTION_LEGAL_TYPES]),
  ]);
  return <section className="shell py-14"><p className="font-bold text-[#0b7197]">{account.type}</p><h1 className="mt-2 text-4xl font-black">{account.displayName}</h1><div className="mt-10 grid gap-8">
    <section><h2 className="mb-4 text-2xl font-black">Products and licenses</h2><div className="grid gap-5 md:grid-cols-2">{licenses.length ? licenses.map((license) => {
      const latest = license.product.versions[0];
      const productName = `${license.product.name}${license.edition ? ` — ${license.edition.name} (${license.purchasePlan ? purchasePlanLabel(license.purchasePlan.type) : "Legacy"})` : ""}`;
      return <CustomerLicenseCard key={license.id} license={{ id: license.id, productName, status: license.status, lastFour: license.keyLastFour, expiresAt: license.expiresAt?.toISOString() ?? null, maxDevices: license.maxSeats * license.maxDevicesPerSeat, activations: license.activations.map((activation) => ({ id: activation.id, label: activation.label, active: activation.active })), downloads: latest?.artifacts.map((artifact) => ({ id: artifact.id, name: artifact.name, version: latest.version })) ?? [] }}/>;
    }) : <Empty/>}</div></section>
    <section><h2 className="mb-4 text-2xl font-black">Product trials</h2><div className="grid gap-3">{trials.length?trials.map((trial)=>{const state=trial.revokedAt?"REVOKED":trial.license.status;return <article className="card p-5" key={trial.id}><div className="flex flex-wrap justify-between gap-3"><div><b>{trial.product.name} — {trial.edition.name}</b><p className="mt-1 text-sm text-slate-600">7-day trial · access through {trial.graceEndsAt.toLocaleString()}</p></div><span className="font-bold">{state}</span></div></article>}):<Empty/>}</div></section>
    <section className="grid gap-6 lg:grid-cols-2"><Panel title="Order history">{orders.length ? orders.map((order) => <div className="rounded-lg bg-slate-50 p-3 text-sm" key={order.id}><div className="flex justify-between"><b>{order.number}</b><span>{order.status}</span></div><p className="mt-1 text-slate-600">{money(order.totalMinor, order.currency)} · {order.items.map((item) => `${item.productName}${item.editionName ? ` — ${item.editionName} (${item.planName})` : ""}`).join(", ")}</p>{order.invoice && <Link className="mt-2 inline-block font-bold text-[#0b7197]" href={`/dashboard/invoices/${order.invoice.id}`}>View invoice</Link>}{order.status === "PENDING" && <PendingOrderActions orderId={order.id} canContinue={order.attempts[0]?.status === "PENDING" && Boolean(order.attempts[0]?.checkoutUrl)}/>}</div>) : <Empty/>}</Panel><Panel title="Subscriptions">{subscriptions.length ? subscriptions.map((subscription) => <div className="rounded-lg bg-slate-50 p-3 text-sm" key={subscription.id}><div className="flex justify-between"><b>{subscription.product.name}{subscription.edition ? ` — ${subscription.edition.name}` : ""}</b><span>{subscription.status}</span></div><p>{subscription.purchasePlan ? purchasePlanLabel(subscription.purchasePlan.type) : "Legacy plan"} · {subscription.seats} seats · through {subscription.currentPeriodEnd.toLocaleDateString()}</p>{subscription.status === "ACTIVE" && <SubscriptionRenewButton subscriptionId={subscription.id} documents={renewalLegal.map(document=>({versionId:document.currentPublishedVersionId!,title:document.title,slug:document.slug}))}/>}</div>) : <Empty/>}</Panel></section>
  </div></section>;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) { return <section className="card p-6"><h2 className="text-xl font-black">{title}</h2><div className="mt-5 grid gap-3">{children}</div></section>; }
function Empty() { return <p className="text-sm text-slate-500">Nothing here yet.</p>; }
function money(minor: number, currency: string) { return new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(minor / 100); }
