"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type Trial = {
  id: string;
  accountName: string;
  productName: string;
  editionName: string;
  trialEndsAt: string;
  graceEndsAt: string;
  revokedAt: string | null;
  source: string;
};

const messages: Record<string, string> = {
  INVALID_GRACE_PERIOD: "Grace must be a whole number from 0 to 14 days.",
  TRIAL_REVOKED: "This trial has already been revoked. Grace cannot be added.",
  NOT_FOUND: "This trial no longer exists. Refresh the page and try again.",
  FORBIDDEN: "Your administrator session cannot perform this action.",
};

function friendlyError(code: unknown, fallback: string) {
  return typeof code === "string" ? (messages[code] ?? fallback) : fallback;
}

function trialState(trial: Trial) {
  if (trial.revokedAt) return "Revoked";
  const now = Date.now();
  if (new Date(trial.graceEndsAt).getTime() <= now) return "Expired";
  if (new Date(trial.trialEndsAt).getTime() <= now) return "Grace period";
  return "Active";
}

export function AdminTrialManager({ accounts, editions, trials }: { accounts: { id: string; name: string }[]; editions: { id: string; name: string }[]; trials: Trial[] }) {
  const router = useRouter();
  const [grantError, setGrantError] = useState("");
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  async function grant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGrantError("");
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/admin/trials", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId: data.get("accountId"), editionId: data.get("editionId"), graceDays: Number(data.get("graceDays")) }) });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      setGrantError(friendlyError(result.error, "Unable to grant the trial. Please try again."));
      return;
    }
    router.refresh();
  }

  async function action(id: string, body: object) {
    setBusyId(id);
    setRowErrors((current) => ({ ...current, [id]: "" }));
    try {
      const response = await fetch(`/api/admin/trials/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        setRowErrors((current) => ({ ...current, [id]: friendlyError(result.error, "Unable to update this trial. Please refresh and try again.") }));
        return;
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return <div className="grid gap-8">
    <form onSubmit={grant} className="card grid gap-4 p-6 md:grid-cols-3">
      <label className="label">Customer account<select className="input" name="accountId" required>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
      <label className="label">Product edition<select className="input" name="editionId" required>{editions.map((edition) => <option key={edition.id} value={edition.id}>{edition.name}</option>)}</select></label>
      <label className="label">Grace period (days)<input className="input" name="graceDays" type="number" min="0" max="14" defaultValue="0" required /></label>
      {grantError && <p className="text-red-700 md:col-span-3" role="alert">{grantError}</p>}
      <button className="button md:col-span-3">Grant 7-day trial</button>
    </form>
    <div className="grid gap-3">{trials.map((trial) => {
      const state = trialState(trial);
      const busy = busyId === trial.id;
      return <article className="card p-5" key={trial.id}>
        <div className="flex flex-wrap justify-between gap-3">
          <div><b>{trial.accountName}</b><p>{trial.productName} — {trial.editionName}</p><p className="text-sm text-slate-600">{trial.source} · trial ends {new Date(trial.trialEndsAt).toLocaleString()} · access ends {new Date(trial.graceEndsAt).toLocaleString()}</p><p className="mt-1 text-sm font-bold">{state}</p></div>
          {!trial.revokedAt && <div className="flex gap-2">
            <button className="button secondary" type="button" disabled={busy} onClick={() => { const value = window.prompt("Grace days after trial (0–14)", "3"); if (value === null) return; const graceDays = Number(value); if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 14) { setRowErrors((current) => ({ ...current, [trial.id]: messages.INVALID_GRACE_PERIOD! })); return; } void action(trial.id, { action: "SET_GRACE", graceDays }); }}>{busy ? "Saving…" : "Set grace"}</button>
            <button className="button secondary" type="button" disabled={busy} onClick={() => { if (window.confirm(`Revoke ${trial.accountName}'s trial access? Active devices will be deactivated immediately.`)) void action(trial.id, { action: "REVOKE" }); }}>{busy ? "Saving…" : "Revoke"}</button>
          </div>}
        </div>
        {rowErrors[trial.id] && <p className="mt-3 text-red-700" role="alert">{rowErrors[trial.id]}</p>}
      </article>;
    })}</div>
  </div>;
}
