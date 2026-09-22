import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/apps/web/auth/session";
import { db } from "@/platform/host/db";
import { requireLegalClearance } from "@/apps/web/legal/clearance";
import { listPendingRecipientClaims } from "@/apps/web/entitlements/claim-codes";
import { listClaimAuthorizedAccounts } from "@/apps/web/accounts/claim-code-authorization";
import { PendingRecipientClaims } from "@/components/pending-recipient-claims";

export default async function DashboardPage() {
  const user = await requireUser().catch(() => redirect("/login"));
  if (user.role === "CUSTOMER") await requireLegalClearance(user.id, "/dashboard");

  const [accounts, pendingClaims, claimAccounts] = await Promise.all([
    db.customerAccount.findMany({
      where: {
        OR: [
          { ownerId: user.id },
          { memberships: { some: { userId: user.id } } },
        ],
      },
      include: {
        memberships: {
          where: { userId: user.id },
          select: { role: true },
          take: 1,
        },
        _count: { select: { orders: true, licenses: true, subscriptions: true } },
      },
    }),
    user.emailVerified ? listPendingRecipientClaims(user.email) : Promise.resolve([]),
    user.emailVerified ? listClaimAuthorizedAccounts(user.id) : Promise.resolve([]),
  ]);

  return <section className="shell py-14">
    <p className="font-bold text-[#0b7197]">Customer portal</p>
    <h1 className="mt-2 text-4xl font-black">Hello, {user.name ?? "there"}.</h1>

    {!user.emailVerified && <div className="mt-7 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-semibold">
      Verify your email before purchasing, activating, or claiming software.
    </div>}

    {pendingClaims.length > 0 && <PendingRecipientClaims
      claims={pendingClaims.map((claim) => ({
        id: claim.claimCodeId,
        orderNumber: claim.orderNumber,
        productName: claim.productName,
        editionName: claim.editionName,
        planName: claim.planName,
        createdAt: claim.createdAt.toISOString(),
        expiresAt: claim.expiresAt?.toISOString() ?? null,
      }))}
      accounts={claimAccounts.map((account) => ({
        id: account.id,
        name: account.displayName,
        type: account.type,
      }))}
    />}

    <div className="mt-8">
      <Link href="/dashboard/organizations/new" className="button">Create organization</Link>
    </div>

    <div className="mt-10 grid gap-6 md:grid-cols-2">
      {accounts.map((account) => {
        const role = account.ownerId === user.id ? "OWNER" : account.memberships[0]?.role ?? "MEMBER";
        const finance = role === "OWNER" || role === "BILLING";
        const licensing = role === "OWNER" || role === "LICENSE_MANAGER";
        return <article className="card p-7" key={account.id}>
          <p className="text-xs font-bold tracking-widest text-[#0b7197]">{account.type} · {role}</p>
          <h2 className="mt-2 text-2xl font-black">{account.displayName}</h2>
          <div className="mt-6 grid grid-cols-3 gap-3 text-center">
            <Stat n={finance ? account._count.orders : 0} label="Orders" />
            <Stat n={licensing ? account._count.licenses : 0} label="Licenses" />
            <Stat n={(finance || licensing) ? account._count.subscriptions : 0} label="Plans" />
          </div>
          {role === "MEMBER" && <p className="mt-4 text-sm text-slate-600">Limited member access. Billing and licensing records are hidden.</p>}
          <Link href={`/dashboard/accounts/${account.id}`} className="button mt-7">Manage account</Link>
        </article>;
      })}
    </div>
  </section>;
}

function Stat({ n, label }: { n: number; label: string }) {
  return <div className="account-stat-card rounded-lg p-3 text-center">
    <p className="text-2xl font-black">{n}</p>
    <p className="text-xs font-semibold text-slate-600">{label}</p>
  </div>;
}
