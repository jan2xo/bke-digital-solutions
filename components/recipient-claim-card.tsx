"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Account = {
  id: string;
  name: string;
  type: "PERSONAL" | "ORGANIZATION";
};

export function RecipientClaimCard({
  claim,
  accounts,
}: {
  claim: {
    id: string;
    productName: string;
    editionName: string | null;
    planType: "PERPETUAL" | "MONTHLY" | "ANNUAL" | null;
    expiresAt: string | null;
  };
  accounts: Account[];
}) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function accept() {
    if (!accountId) return;
    setBusy(true);
    setError("");
    const response = await fetch(`/api/claims/${claim.id}/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ customerAccountId: accountId }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(({
        RECIPIENT_CLAIM_NOT_FOUND: "This pending license is no longer available.",
        RECIPIENT_CLAIM_ALREADY_USED: "This license has already been claimed.",
        RECIPIENT_CLAIM_REVOKED: "This pending license was revoked.",
        RECIPIENT_CLAIM_EXPIRED: "This pending license has expired.",
        RECIPIENT_CLAIM_EMAIL_MISMATCH: "This license is reserved for a different verified email.",
        ACCOUNT_ROLE_FORBIDDEN: "You cannot add licenses to that account.",
      } as Record<string, string>)[body.error] ?? "Unable to accept this license.");
      setBusy(false);
      return;
    }
    router.refresh();
  }

  return (
    <article className="card p-6">
      <p className="text-xs font-bold tracking-widest text-[#ffd15a]">LICENSE FOR YOU</p>
      <h2 className="mt-2 text-xl font-black">{claim.productName}</h2>
      <p className="mt-1 text-sm text-[#a8b5c4]">
        {claim.editionName ?? "Standard"}
        {claim.planType ? ` · ${claim.planType === "PERPETUAL" ? "Perpetual" : claim.planType}` : ""}
      </p>
      {claim.expiresAt && (
        <p className="mt-2 text-xs text-[#a8b5c4]">
          Claim before {new Date(claim.expiresAt).toLocaleString()}.
        </p>
      )}

      {accounts.length ? (
        <div className="mt-5 grid gap-3">
          <label className="label">
            Add this license to
            <select className="input" value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              {accounts.map((account) => (
                <option value={account.id} key={account.id}>
                  {account.name} · {account.type === "PERSONAL" ? "Personal" : "Organization"}
                </option>
              ))}
            </select>
          </label>
          <button className="button" disabled={busy || !accountId} onClick={accept}>
            {busy ? "Adding license…" : "Accept license"}
          </button>
        </div>
      ) : (
        <p className="mt-5 text-sm text-[#a8b5c4]">
          You do not currently have an active account where you can accept this license.
        </p>
      )}
      {error && <p className="mt-3 text-sm font-bold text-red-700" role="alert">{error}</p>}
    </article>
  );
}
