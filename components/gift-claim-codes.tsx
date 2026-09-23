"use client";

import { useState } from "react";

type GiftClaim = Readonly<{
  id: string;
  orderNumber: string;
  productName: string;
  editionName: string | null;
  planName: string | null;
  lastFour: string;
  status: "AVAILABLE" | "CLAIMED" | "REVOKED" | "EXPIRED";
  createdAt: string;
  expiresAt: string | null;
}>;

export function GiftClaimCodes({
  customerAccountId,
  claims,
}: {
  customerAccountId: string;
  claims: readonly GiftClaim[];
}) {
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  async function reveal(id: string) {
    setBusyId(id);
    setError("");
    const response = await fetch(`/api/claims/${id}/reveal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ customerAccountId }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error === "RECENT_AUTH_REQUIRED"
        ? "Sign in again before revealing a gift Claim Code."
        : "Unable to reveal this Claim Code.");
      setBusyId("");
      return;
    }
    setRevealed((current) => ({ ...current, [id]: body.claimCode }));
    setBusyId("");
  }

  return <section>
    <h2 className="mb-4 text-2xl font-black">Gift Claim Codes</h2>
    <p className="mb-4 text-sm text-[#a8b5c4]">
      Send an available code to anyone you choose. The first eligible BKE account that successfully redeems it becomes the software owner.
    </p>
    <div className="grid gap-4">
      {claims.map((claim) => <article className="card p-5" key={claim.id}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-black">{claim.productName}{claim.editionName ? ` — ${claim.editionName}` : ""}</h3>
            <p className="mt-1 text-sm text-[#a8b5c4]">
              {claim.planName ?? "License"} · order {claim.orderNumber} · code •••• {claim.lastFour}
            </p>
            <p className="mt-1 text-xs font-bold">{claim.status}</p>
          </div>
          {claim.status === "AVAILABLE" && !revealed[claim.id] &&
            <button className="button secondary" disabled={busyId === claim.id} onClick={() => reveal(claim.id)}>
              {busyId === claim.id ? "Revealing…" : "Reveal gift code"}
            </button>}
        </div>
        {revealed[claim.id] && <div className="mt-4 rounded-lg bg-amber-50 p-4 text-amber-950">
          <p className="text-xs font-bold uppercase">One-time Claim Code</p>
          <code className="mt-2 block break-all text-base font-black">{revealed[claim.id]}</code>
          <p className="mt-2 text-xs">Share this code with the intended recipient. It becomes useless after successful redemption.</p>
        </div>}
      </article>)}
    </div>
    {error && <p role="alert" className="mt-4 text-sm font-bold text-red-500">{error}</p>}
  </section>;
}
