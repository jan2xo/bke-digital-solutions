"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ProductDeletionDependencies, ProductDeletionEligibility } from "@/lib/product-deletion";

const labels: Record<keyof ProductDeletionDependencies, string> = {
  carts: "Customer carts",
  orderItems: "Order items",
  orders: "Orders",
  invoices: "Invoices",
  payments: "Payments",
  paymentAttempts: "Payment attempts",
  subscriptions: "Subscriptions",
  trials: "Product trials",
  licenses: "Licenses",
  assignments: "License assignments",
  activations: "Device activations",
  downloadGrants: "Download grants",
  downloads: "Downloads",
  licenseEvents: "License events",
};

export function AdminProductDelete({ productId, productName }: { productId: string; productName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [eligibility, setEligibility] = useState<ProductDeletionEligibility | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function showDialog() {
    setOpen(true);
    setError("");
    setEligibility(null);
    const response = await fetch(`/api/admin/products/${productId}/deletion`, { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (!response.ok) setError(payload?.error ?? "Unable to check deletion eligibility.");
    else setEligibility(payload);
  }

  async function remove() {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/admin/products/${productId}/deletion`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmationName: confirmation }),
    });
    if (response.status === 204) {
      setOpen(false);
      router.refresh();
      return;
    }
    const payload = await response.json().catch(() => null);
    setEligibility((current) => current && payload?.dependencies ? { ...current, canDelete: false, reason: payload.reason ?? current.reason, blockingDependencies: payload.dependencies } : current);
    setError(payload?.message ?? payload?.error ?? "Unable to delete product.");
    setBusy(false);
  }

  const blockers = eligibility
    ? Object.entries(eligibility.blockingDependencies).filter((entry): entry is [keyof ProductDeletionDependencies, number] => entry[1] > 0)
    : [];

  return <>
    <button type="button" className="button danger" onClick={showDialog}>Delete permanently</button>
    {open && <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="presentation">
      <section className="card w-full max-w-xl p-6" role="dialog" aria-modal="true" aria-labelledby={`delete-${productId}-title`}>
        <h2 id={`delete-${productId}-title`} className="text-2xl font-black">Delete product permanently?</h2>
        <p className="mt-3 text-sm text-slate-700">This action cannot be undone. Deletion proceeds only when there are no orders, licenses, downloads, or other preserved records.</p>
        {!eligibility && !error && <p className="mt-4" role="status">Checking dependencies…</p>}
        {eligibility && !eligibility.canDelete && <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="font-bold">This archived product must be retained.</p>
          {blockers.length > 0
            ? <ul className="mt-2 list-disc pl-5 text-sm">{blockers.map(([key, count]) => <li key={key}>{labels[key]}: {count}</li>)}</ul>
            : <p className="mt-2 text-sm">The product is not eligible for permanent deletion.</p>}
        </div>}
        {eligibility?.canDelete && <label className="label mt-5">Type <span className="select-all">{productName}</span> to confirm
          <input className="input" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" />
        </label>}
        {error && <p className="mt-4 font-bold text-red-700" role="alert">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" className="button secondary" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
          {eligibility?.canDelete && <button type="button" className="button danger disabled:cursor-not-allowed disabled:opacity-50" disabled={busy || confirmation !== productName} onClick={remove}>{busy ? "Deleting…" : "Delete permanently"}</button>}
        </div>
      </section>
    </div>}
  </>;
}
