"use client";
import { useState } from "react";

export function ObservabilityActions({ id, status }: { id: string; status: string }) {
  const [busy, setBusy] = useState(false);
  async function act(action: "ACKNOWLEDGE" | "RESOLVE") { setBusy(true); await fetch("/api/admin/observability", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, action }) }); window.location.reload(); }
  if (status === "RESOLVED") return null;
  return <div className="flex gap-2">{status === "OPEN" && <button className="rounded border px-3 py-2 text-sm font-bold" disabled={busy} onClick={() => act("ACKNOWLEDGE")}>Acknowledge</button>}<button className="rounded border px-3 py-2 text-sm font-bold" disabled={busy} onClick={() => act("RESOLVE")}>Resolve</button></div>;
}
