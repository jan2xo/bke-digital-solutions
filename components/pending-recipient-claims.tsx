"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Claim = Readonly<{
  id: string;
  orderNumber: string;
  productName: string;
  editionName: string | null;
  planName: string | null;
  createdAt: string;
  expiresAt: string | null;
}>;

type Account = Readonly<{
  id: string;
  name: string;
  type: string;
}>;

export function PendingRecipientClaims({
  claims,
  accounts,
}: {
  claims: readonly Claim[];
  accounts: readonly Account[];
}) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  async function accept(claimId: string) {
    if (!accountId) {
      setError("Choose an account that can receive this license.");
      return;
    }
    setBusyId(claimId);
    setError("");

    const response = await fetch(`/api/claims/${claimId}/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ customerAccountId: accountId }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setError(({
        RECIPIENT_CLAIM_EMAIL_MISMATCH: "This license was purchased for a different verified email.",
        RECIPIENT_CLAIM_REVOKED: "This license is no longer available to claim.",
        RECIPIENT_CLAIM_EXPIRED: "This claim has expired.",
        ACCOUNT_ROLE_FORBIDDEN: "Your role cannot receive licenses into that account.",
      } as Record<string, string>)[payload.error] ?? "The license could not be claimed.");
      setBusyId("");
      return;
    }

    router.refresh();
  }

  return <section className="card mt-8 p-7">
    <p className="text-xs font-bold tracking-widest text-[#ffd15a]">LICENSES WAITING FOR YOU</p>
    <h2 className="mt-2 text-2xl font-black">Purchased for your email</h2>
    <p className="mt-2 text-sm text-[#a8b5c4]">
      No license key is required. Choose where you want to own each license, then claim it.
    </p>

    {accounts.length > 0
      ? <label className="label mt-5">
          Receive into
          <select className="input" value={accountId} onChange={(event) => setAccountId(event.target.value)}>
            {accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.type}</option>)}
          </select>
        </label>
      : <p className="mt-5 text-sm font-semibold text-amber-300">You do not currently have an account role that can receive licenses.</p>}

    <div className="mt-5 grid gap-3">
      {claims.map((claim) => <article className="rounded-xl border border-[#2d3850] bg-[#151d29] p-5" key={claim.id}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-black">{claim.productName}{claim.editionName ? ` — ${claim.editionName}` : ""}</h3>
            <p className="mt-1 text-sm text-[#a8b5c4]">
              {claim.planName ?? "License"} · order {claim.orderNumber}
            </p>
          </div>
          <button className="button" disabled={!accountId || Boolean(busyId)} onClick={() => accept(claim.id)}>
            {busyId === claim.id ? "Claiming…" : "Claim license"}
          </button>
        </div>
      </article>)}
    </div>

    {error && <p role="alert" className="mt-4 text-sm font-bold text-red-500">{error}</p>}
  </section>;
}
