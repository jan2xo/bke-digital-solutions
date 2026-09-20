"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type SessionView = { id: string; current: boolean; summary: string; network: string; lastSeen: string; expires: string; method: string; assurance: string };

export function AdminSessionManager({ sessions }: { sessions: SessionView[] }) {
  const router = useRouter(); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  async function revoke(body: Record<string, string>) {
    setBusy(true); setMessage("");
    const response = await fetch("/api/admin/security/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json(); setBusy(false);
    if (response.status === 403 && result.error === "RECENT_AUTH_REQUIRED") return router.push(`/security/recent?returnTo=${encodeURIComponent("/admin/security")}`);
    if (!response.ok) return setMessage(result.error ?? "Session revocation failed.");
    if (result.signedOut) return router.replace("/login");
    setMessage("Session access was revoked."); router.refresh();
  }
  return <section><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-2xl font-bold">Your administrator sessions</h2><div className="flex gap-2"><button disabled={busy} className="button-secondary" onClick={() => confirm("Revoke every other session?") && revoke({ action: "OTHERS" })}>Revoke other sessions</button><button disabled={busy} className="button-secondary" onClick={() => confirm("Sign out everywhere, including this browser?") && revoke({ action: "ALL", confirmation: "REVOKE ALL SESSIONS" })}>Sign out everywhere</button></div></div>{message && <p className="mt-3" role="status">{message}</p>}<div className="card mt-3 grid gap-0 overflow-hidden">{sessions.map((session) => <div key={session.id} className="grid gap-2 border-b p-4 md:grid-cols-[1fr_auto]"><div><strong>{session.summary}{session.current ? " (current session)" : ""}</strong><p className="text-sm text-slate-600">{session.network} · {session.method.replaceAll("_", " ")} · {session.assurance.replaceAll("_", " ")}</p><p className="text-sm text-slate-600">Last active {session.lastSeen} · expires {session.expires}</p></div><button disabled={busy} className="button-secondary" onClick={() => confirm(session.current ? "Sign out this browser?" : "Revoke this session?") && revoke({ action: "ONE", sessionId: session.id })}>{session.current ? "Sign out" : "Revoke"}</button></div>)}</div></section>;
}
