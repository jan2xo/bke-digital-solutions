"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type Status = { id: string; provider: "PAYMONGO" | "RESEND"; environment: "TEST" | "LIVE"; enabled: boolean; senderName: string | null; senderEmail: string | null; supportEmail: string | null; validationStatus: string; lastValidationCode: string | null; lastValidatedAt: string | null; credentials: { type: string; hint: string; createdAt: string }[] };

export function AdminProviderManager({ statuses }: { statuses: Status[] }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function send(payload: Record<string, unknown>) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/providers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (response.status === 403) { router.push(`/security/recent?returnTo=${encodeURIComponent("/admin/providers")}`); return; }
      const body = await response.json();
      if (!response.ok) return setMessage(body.error ?? "Provider operation failed.");
      setMessage(payload.action === "VALIDATE" ? (body.valid ? "Provider credentials validated." : `Validation failed: ${body.code}`) : "Provider configuration updated.");
      router.refresh();
    } finally { setBusy(false); }
  }
  async function save(event: FormEvent<HTMLFormElement>, provider: "PAYMONGO" | "RESEND") {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    const payload: Record<string, unknown> = { action: "SAVE", provider, environment: provider === "PAYMONGO" ? "TEST" : "LIVE" };
    for (const name of ["secretKey", "webhookSecret", "apiKey", "senderName", "senderEmail", "supportEmail"]) { const value = data.get(name); if (typeof value === "string" && value.trim()) payload[name] = value.trim(); }
    await send(payload); form.reset();
  }
  const statusFor = (provider: Status["provider"], environment: Status["environment"]) => statuses.find((item) => item.provider === provider && item.environment === environment);
  const panel = (provider: "PAYMONGO" | "RESEND", environment: "TEST" | "LIVE") => {
    const status = statusFor(provider, environment);
    return <section className="card grid gap-4 p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-2xl font-bold">{provider === "PAYMONGO" ? "PayMongo sandbox" : "Resend transactional email"}</h2><p className="text-sm text-slate-600">{environment} · {status?.enabled ? "enabled" : "disabled"} · {status?.validationStatus ?? "not configured"}</p></div>{status?.lastValidatedAt && <span className="text-sm text-slate-500">Validated {new Date(status.lastValidatedAt).toLocaleString()}</span>}</div>{status?.credentials.length ? <ul className="grid gap-1 text-sm">{status.credentials.map((credential) => <li key={credential.type}><strong>{credential.type}:</strong> <code>{credential.hint}</code></li>)}</ul> : <p className="text-sm text-slate-600">No database credentials stored.</p>}<form className="grid gap-3" onSubmit={(event) => save(event, provider)}>{provider === "PAYMONGO" ? <><label className="label">New secret key<input className="input" type="password" name="secretKey" autoComplete="off" placeholder="Leave blank to keep the stored value"/></label><label className="label">New webhook signing secret<input className="input" type="password" name="webhookSecret" autoComplete="off" placeholder="Leave blank to keep the stored value"/></label></> : <><label className="label">New API key<input className="input" type="password" name="apiKey" autoComplete="off" placeholder="Leave blank to keep the stored value"/></label><label className="label">Sender name<input className="input" name="senderName" defaultValue={status?.senderName ?? "BKE Digital Solutions"}/></label><label className="label">Sender email<input className="input" type="email" name="senderEmail" defaultValue={status?.senderEmail ?? "noreply@jl-bke.com"}/></label><label className="label">Support email<input className="input" type="email" name="supportEmail" defaultValue={status?.supportEmail ?? "support@jl-bke.com"}/></label></>}<button className="button" disabled={busy}>Save encrypted configuration</button></form><div className="flex flex-wrap gap-2"><button className="button-secondary" disabled={busy || !status} onClick={() => send({ action: "VALIDATE", provider, environment })}>Validate</button><button className="button-secondary" disabled={busy || !status || status.validationStatus !== "VALID"} onClick={() => send({ action: status?.enabled ? "DISABLE" : "ENABLE", provider, environment })}>{status?.enabled ? "Disable" : "Enable"}</button><button className="rounded border border-red-400 px-4 py-2 font-bold text-red-700" disabled={busy || !status} onClick={() => confirm("Revoke the stored credentials and disable this provider?") && send({ action: "REVOKE", provider, environment })}>Revoke</button></div></section>;
  };
  return <div className="mt-8 grid gap-6">{panel("PAYMONGO", "TEST")}{panel("RESEND", "LIVE")}<section className="card p-6 opacity-70"><h2 className="text-xl font-bold">PayMongo live</h2><p className="mt-2 text-sm">Live payment credentials remain locked during local production simulation. They cannot be saved, validated, or enabled here.</p></section>{message && <p role="status" className="font-bold">{message}</p>}</div>;
}
