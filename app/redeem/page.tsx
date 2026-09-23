import Link from "next/link";
import { redirect } from "next/navigation";
import { currentIdentitySession } from "@/apps/web/auth/session";
import { listClaimAuthorizedAccounts } from "@/apps/web/accounts/claim-code-authorization";
import { requireLegalClearance } from "@/apps/web/legal/clearance";
import { ClaimCodeRedeemer } from "@/components/claim-code-redeemer";

export default async function RedeemClaimCodePage() {
  const session = await currentIdentitySession();
  if (!session) redirect("/login?returnTo=%2Fredeem");
  const principal = session.principal;
  if (!principal.emailVerified) redirect("/verify-email");
  await requireLegalClearance(principal.id, "/redeem");

  const accounts = await listClaimAuthorizedAccounts(principal.id);

  return <section className="mx-auto max-w-2xl px-4 py-14">
    <Link className="text-sm font-bold text-sky-300 underline underline-offset-2" href="/dashboard">
      Back to dashboard
    </Link>
    <p className="mt-7 text-xs font-bold tracking-widest text-[#ffd15a]">CLAIM CODE</p>
    <h1 className="mt-2 text-4xl font-black">Redeem software</h1>
    <p className="mt-3 text-[#a8b5c4]">
      Enter a BKE Claim Code you received and choose the Personal or Organization account that should own the software.
    </p>
    {accounts.length > 0
      ? <ClaimCodeRedeemer accounts={accounts} />
      : <div className="card mt-8 p-7">
          <p className="font-bold">No eligible account</p>
          <p className="mt-2 text-sm text-[#a8b5c4]">
            You need an active account role allowed to receive software before you can redeem this code.
          </p>
        </div>}
  </section>;
}
