"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AdminStorageCleanupActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const action = status === "FAILED" ? "RETRY" : "PROCESS";
  if (!["PENDING", "RETRYING", "FAILED"].includes(status)) return <span>—</span>;
  async function run() {
    setBusy(true); setMessage("");
    const response = await fetch(`/api/admin/storage-cleanup/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    setMessage(response.ok ? "Processed" : "Action failed");
    setBusy(false);
    if (response.ok) router.refresh();
  }
  return <div><button className="rounded border px-3 py-1 text-xs font-bold" disabled={busy} onClick={run}>{busy ? "Working…" : action === "RETRY" ? "Retry" : "Process"}</button>{message && <p className="mt-1 text-xs">{message}</p>}</div>;
}
