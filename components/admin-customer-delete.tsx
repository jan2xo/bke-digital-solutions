"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Report = { blockers: string[]; counts: Record<string, number>; canPseudonymize: boolean; canMarkPurgeEligible: boolean; canPurge: boolean };
export function AdminCustomerDelete({ customerId, lifecycleState, legalHold, initialReport }: { customerId: string; customerEmail?: string; lifecycleState: string; legalHold: boolean; initialReport: Report }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retentionDate, setRetentionDate] = useState("");
  async function action(body: Record<string, unknown>) {
    setBusy(true); setError("");
    const response = await fetch(`/api/admin/customers/${customerId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (response.status === 204) { router.push("/admin/customers"); router.refresh(); return; }
    const payload = await response.json().catch(() => null);
    if (!response.ok) setError(payload?.error ?? "Lifecycle action failed."); else router.refresh();
    setBusy(false);
  }
  function confirmedAction(phrase: string, body: Record<string, unknown>) {
    if (window.prompt(`Type ${phrase} to continue`) === phrase) void action(body);
  }
  return <section className="card border-amber-500/60 p-6">
    <h2 className="text-xl font-black">Customer lifecycle and retention</h2>
    <p className="mt-2 text-sm text-muted">Current state: <b>{lifecycleState}</b>. Closure preserves commerce, licensing, legal acceptance, and audit history.</p>
    <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">{Object.entries(initialReport.counts).map(([label, count]) => <div key={label} className="rounded border p-2"><b>{count}</b> {label}</div>)}</div>
    {initialReport.blockers.length > 0 && <div className="mt-4 rounded border border-red-400 bg-red-50 p-3 text-sm text-red-900"><b>Retention blockers</b><ul className="list-disc pl-5">{initialReport.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></div>}
    {error && <p className="mt-4 font-bold text-red-600" role="alert">{error}</p>}
    <div className="mt-5 flex flex-wrap gap-2">
      <button className="button secondary" disabled={busy || lifecycleState !== "ACTIVE"} onClick={() => confirmedAction("CLOSE CUSTOMER ACCOUNT", { action: "CLOSE", confirmation: "CLOSE CUSTOMER ACCOUNT" })}>Close account</button>
      <button className="button secondary" disabled={busy || lifecycleState !== "CLOSED"} onClick={() => action({ action: "REOPEN" })}>Reopen account</button>
      <label className="label">Retention expiry<input className="input" type="datetime-local" value={retentionDate} onChange={(event) => setRetentionDate(event.target.value)} /></label>
      <button className="button secondary" disabled={busy || !retentionDate} onClick={() => confirmedAction("START PRIVACY REVIEW", { action: "PRIVACY_REVIEW", retentionExpiresAt: new Date(retentionDate).toISOString(), confirmation: "START PRIVACY REVIEW" })}>Start privacy review</button>
      <button className="button secondary" disabled={busy} onClick={() => action({ action: "LEGAL_HOLD", enabled: !legalHold, reason: legalHold ? undefined : "Administrative review" })}>{legalHold ? "Remove legal hold" : "Apply legal hold"}</button>
      <button className="button danger" disabled={busy || !initialReport.canPseudonymize} onClick={() => confirmedAction("PSEUDONYMIZE PERSONAL DATA", { action: "PSEUDONYMIZE", confirmation: "PSEUDONYMIZE PERSONAL DATA" })}>Pseudonymize</button>
      <button className="button danger" disabled={busy || !initialReport.canMarkPurgeEligible} onClick={() => action({ action: "MARK_PURGE_ELIGIBLE" })}>Mark purge eligible</button>
      <button className="button danger" disabled={busy || !initialReport.canPurge} onClick={() => confirmedAction(`PURGE ${customerId}`, { action: "PURGE", confirmation: `PURGE ${customerId}` })}>Execute final purge</button>
    </div>
    <p className="mt-3 text-xs text-muted">Final retention periods require professional legal, privacy, tax, and accounting review. The administrator must supply the reviewed retention-expiry date.</p>
  </section>;
}
