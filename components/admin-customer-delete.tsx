"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const ACKNOWLEDGEMENT = "DELETE ALL CUSTOMER DATA";

export function AdminCustomerDelete({ customerId, customerEmail }: { customerId: string; customerEmail: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const confirmed = email.trim().toLowerCase() === customerEmail.toLowerCase() && phrase === ACKNOWLEDGEMENT;

  async function remove() {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/admin/customers/${customerId}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmationEmail: email, acknowledgement: phrase }),
    });
    if (response.status === 204) {
      router.push("/admin/customers");
      router.refresh();
      return;
    }
    const payload = await response.json().catch(() => null);
    setError(payload?.error === "RECENT_AUTH_REQUIRED"
      ? "For security, sign out and sign in again before deleting this customer."
      : payload?.error ?? "Unable to delete this customer.");
    setBusy(false);
  }

  return <section className="card border-red-500/60 p-6">
    <h2 className="text-xl font-black text-red-400">Danger zone</h2>
    <p className="mt-2 text-sm text-muted">Permanently delete this customer and all owned accounts, orders, payments, invoices, subscriptions, licenses, activations, downloads, and authentication records.</p>
    <button type="button" className="button danger mt-5" onClick={() => setOpen(true)}>Delete customer permanently</button>
    {open && <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="presentation">
      <section className="card w-full max-w-xl border-red-500 p-6" role="dialog" aria-modal="true" aria-labelledby={`delete-customer-${customerId}`}>
        <h2 id={`delete-customer-${customerId}`} className="text-2xl font-black text-red-400">Delete all customer data?</h2>
        <p className="mt-3 font-bold text-text">This cannot be undone. Financial and licensing history will also be erased.</p>
        <p className="mt-2 text-sm text-muted">Confirm your legal and accounting retention requirements before continuing. A redacted audit tombstone will remain, but it will not contain the customer email or other personal data.</p>
        <label className="label mt-5">Type the customer email
          <input className="input" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="off" spellCheck={false} />
        </label>
        <label className="label mt-4">Type <span className="select-all">{ACKNOWLEDGEMENT}</span>
          <input className="input" value={phrase} onChange={(event) => setPhrase(event.target.value)} autoComplete="off" spellCheck={false} />
        </label>
        {error && <p className="mt-4 font-bold text-red-400" role="alert">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" className="button secondary" disabled={busy} onClick={() => { setOpen(false); setError(""); }}>Cancel</button>
          <button type="button" className="button danger disabled:cursor-not-allowed disabled:opacity-50" disabled={busy || !confirmed} onClick={remove}>{busy ? "Deleting everything…" : "Permanently delete everything"}</button>
        </div>
      </section>
    </div>}
  </section>;
}
