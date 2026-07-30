"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PendingOrderActions({ orderId }: { orderId: string; canContinue: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"continue" | "cancel" | null>(null);
  const [error, setError] = useState("");

  async function continuePayment() {
    setBusy("continue"); setError("");
    const response = await fetch(`/api/orders/${orderId}/continue`, { method: "POST" });
    const payload = await response.json();
    if (!response.ok) { setError("The secure checkout is no longer available. Cancel this order and start a new checkout."); setBusy(null); return; }
    window.location.assign(payload.checkoutUrl);
  }

  async function cancel() {
    if (!window.confirm("Cancel this pending order? If the payment provider has already captured payment, a later verified confirmation will still complete the order.")) return;
    setBusy("cancel"); setError("");
    const response = await fetch(`/api/orders/${orderId}/cancel`, { method: "POST" });
    if (!response.ok) { setError("This order could not be cancelled. Its payment status may have changed."); setBusy(null); return; }
    router.refresh();
  }

  return <div className="mt-3">
    <div className="flex flex-wrap gap-2">
      <button type="button" className="button" disabled={busy !== null} onClick={continuePayment}>{busy === "continue" ? "Opening secure payment…" : "Continue secure payment"}</button>
      <button type="button" className="button secondary" disabled={busy !== null} onClick={cancel}>{busy === "cancel" ? "Cancelling…" : "Cancel order"}</button>
    </div>
    {error && <p className="mt-2 text-sm font-semibold text-red-700" role="alert">{error}</p>}
  </div>;
}
