"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

async function post(url: string, body: object) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json() as { error?: string };
  if (!response.ok) throw new Error(result.error ?? "BACKUP_ACTION_FAILED");
}

export function CreateBackupActions() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  async function create(dryRun: boolean) {
    setMessage("Queuing…");
    try { await post("/api/admin/backups", { dryRun }); setMessage(dryRun ? "Dry run queued." : "Backup queued."); router.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "BACKUP_ACTION_FAILED"); }
  }
  return <div className="flex flex-wrap items-center gap-3"><button className="button" onClick={() => create(false)}>Create backup</button><button className="button-secondary" onClick={() => create(true)}>Dry run</button><span aria-live="polite" className="text-sm text-muted">{message}</span></div>;
}

export function BackupActions({ id, expired }: { id: string; expired: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  async function action(type: "VERIFY" | "SIMULATE_RESTORE" | "RESTORE_ISOLATED" | "DELETE_EXPIRED") {
    let confirmation: string | undefined;
    if (type === "RESTORE_ISOLATED") {
      confirmation = window.prompt(`Type RESTORE TO ISOLATED TARGET ${id}`) ?? undefined;
      if (!confirmation) return;
    }
    setMessage("Queuing…");
    try { await post(`/api/admin/backups/${id}/actions`, { action: type, confirmation, dryRun: false }); setMessage("Operation queued."); router.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "BACKUP_ACTION_FAILED"); }
  }
  return <div className="flex flex-wrap items-center gap-2"><button className="button-secondary" onClick={() => action("VERIFY")}>Verify</button><button className="button-secondary" onClick={() => action("SIMULATE_RESTORE")}>Simulate restore</button><button className="button-secondary" onClick={() => action("RESTORE_ISOLATED")}>Restore to isolated target</button>{expired && <button className="rounded border border-red-600 px-3 py-2 font-bold text-red-700" onClick={() => action("DELETE_EXPIRED")}>Delete expired</button>}<span aria-live="polite" className="text-sm text-muted">{message}</span></div>;
}
