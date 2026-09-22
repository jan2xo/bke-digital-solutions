import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/apps/web/auth/session";
import { listClaimAuthorizedAccounts } from "@/apps/web/accounts/claim-code-authorization";
import { listPendingRecipientClaims } from "@/apps/web/entitlements/recipient-claims";
import { RecipientClaimCard } from "@/components/recipient-claim-card";

export default async function RecipientClaimsPage() {
  const user = await requireUser().catch(() => redirect("/login?returnTo=%2Fdashboard%2Fclaims"));
  if (!user.emailVerified) redirect("/verify-email");

  const [claims, accounts] = await Promise.all([
    listPendingRecipientClaims(user.email),
    listClaimAuthorizedAccounts(user.id),
  ]);

  return (
    <section className="shell py-14">
      <p className="font-bold text-[#ffd15a]">Pending licenses</p>
      <h1 className="mt-2 text-4xl font-black">Licenses purchased for you</h1>
      <p className="mt-4 max-w-3xl text-[#a8b5c4]">
        These licenses are reserved for your verified email. Choose the Personal or Organization account
        that should own each license. The purchaser never receives the entitlement first.
      </p>

      <div className="mt-8">
        <Link className="font-bold text-sky-300 underline underline-offset-2" href="/dashboard">
          Back to dashboard
        </Link>
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-2">
        {claims.length ? claims.map((claim) => (
          <RecipientClaimCard
            key={claim.id}
            claim={{
              id: claim.id,
              productName: claim.productName,
              editionName: claim.editionName,
              planType: claim.planType,
              expiresAt: claim.expiresAt?.toISOString() ?? null,
            }}
            accounts={accounts.map((account) => ({
              id: account.id,
              name: account.displayName,
              type: account.type,
            }))}
          />
        )) : (
          <div className="card p-7 md:col-span-2">
            <h2 className="text-xl font-black">No pending licenses</h2>
            <p className="mt-2 text-sm text-[#a8b5c4]">
              When someone purchases a license for your verified email, it will appear here.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
