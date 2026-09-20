"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Account = { id: string; name: string };

export function TrialStartButton({ editionId, accounts }: { editionId: string; accounts: Account[] }) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  if (!accounts.length) return <Link className="button secondary" href={`/login?returnTo=${encodeURIComponent("/products")}`}>Sign in for 7-day trial</Link>;

  async function start() {
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/trials", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ editionId, accountId }),
    });
    const body = await response.json();
    if (!response.ok) {
      setMessage(body.error === "TRIAL_ALREADY_USED_THIS_YEAR" ? "This account already used its annual trial for this product." : "The trial could not be started.");
      setBusy(false);
      return;
    }
    router.push(`/dashboard/accounts/${accountId}`);
    router.refresh();
  }

  return <div className="grid gap-3">
    {accounts.length > 1 && <label className="text-sm font-semibold">Trial account<select className="input mt-1" value={accountId} onChange={(event) => setAccountId(event.target.value)}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>}
    <button type="button" className="button secondary" onClick={start} disabled={busy}>{busy ? "Starting trial…" : "Start free 7-day trial"}</button>
    {message && <p role="alert" className="text-sm font-semibold text-red-700">{message}</p>}
  </div>;
}
