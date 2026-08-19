"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { COMPLIANCE_STATUS_LABELS, COMPLIANCE_STATUSES } from "@/lib/compliance";

export function ComplianceAdminControls({ requirementId, currentStatus }: { requirementId: string; currentStatus: string }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function post(payload: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/admin/compliance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json().catch(() => ({}));
    setBusy(false);
    if (response.status === 403 && result.error === "RECENT_AUTH_REQUIRED") {
      router.push(`/security/recent?returnTo=${encodeURIComponent("/admin/compliance")}`);
      return;
    }
    if (!response.ok) { setMessage(result.error ?? "The compliance update failed."); return; }
    setMessage("Compliance register updated.");
    router.refresh();
  }

  return <div className="mt-4 grid gap-3 border-t pt-4 md:grid-cols-2">
    <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void post({ action: "STATUS", id: requirementId, status: form.get("status") }); }}>
      <label className="block text-xs font-bold uppercase text-slate-500">Review state</label>
      <select name="status" defaultValue={currentStatus} className="w-full rounded-xl border px-3 py-2 text-sm" disabled={busy}>
        {currentStatus === "IMPLEMENTED" && <option value="IMPLEMENTED">Implemented</option>}
        {COMPLIANCE_STATUSES.map((status) => <option key={status} value={status}>{COMPLIANCE_STATUS_LABELS[status]}</option>)}
      </select>
      <button className="rounded-xl bg-[#3d75a7] px-3 py-2 text-sm font-bold text-white disabled:opacity-50" disabled={busy}>Save review state</button>
    </form>
    <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void post({ action: "EVIDENCE", id: requirementId, kind: form.get("kind"), summary: form.get("summary"), reference: form.get("reference") || undefined }); event.currentTarget.reset(); }}>
      <label className="block text-xs font-bold uppercase text-slate-500">Append immutable evidence</label>
      <input name="kind" className="w-full rounded-xl border px-3 py-2 text-sm" maxLength={80} placeholder="Evidence type" required disabled={busy} />
      <textarea name="summary" className="w-full rounded-xl border px-3 py-2 text-sm" maxLength={500} placeholder="Evidence summary" required disabled={busy} />
      <input name="reference" className="w-full rounded-xl border px-3 py-2 text-sm" maxLength={300} placeholder="Reference URL or ticket" disabled={busy} />
      <button className="rounded-xl bg-[#3d75a7] px-3 py-2 text-sm font-bold text-white disabled:opacity-50" disabled={busy}>Record evidence</button>
    </form>
    {currentStatus !== "IMPLEMENTED" && <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); if (!window.confirm("Confirm that the required review or owner decision has been received and accepted for this requirement?")) return; void post({ action: "COMPLETE", id: requirementId, confirmation: true }); }}><label className="block text-xs font-bold uppercase text-slate-500">Owner acceptance</label><p className="text-xs text-slate-600">Evidence remains separate. This explicit action records the authenticated Owner/Admin decision.</p><button type="submit" className="rounded-xl bg-[#213a53] px-3 py-2 text-sm font-bold text-white disabled:opacity-50" disabled={busy}>Mark Implemented</button></form>}
    {currentStatus === "IMPLEMENTED" && <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); if (!window.confirm("Reopen this implemented requirement for a new review?")) return; void post({ action: "REOPEN", id: requirementId, status: form.get("status"), confirmation: true }); }}><label className="block text-xs font-bold uppercase text-slate-500">Reopen review</label><p className="text-xs text-slate-600">Historical evidence remains preserved. Reopening blocks release readiness until accepted again.</p><div className="flex gap-2"><select name="status" className="rounded-xl border px-3 py-2 text-sm" defaultValue="PENDING_OWNER_DECISION">{COMPLIANCE_STATUSES.map((status) => <option key={status} value={status}>{COMPLIANCE_STATUS_LABELS[status]}</option>)}</select><button type="submit" className="rounded-xl border border-red-400 px-3 py-2 text-sm font-bold text-red-700 disabled:opacity-50" disabled={busy}>Reopen Review</button></div></form>}
    {message && <p className="md:col-span-2 text-sm font-bold text-slate-600">{message}</p>}
  </div>;
}
