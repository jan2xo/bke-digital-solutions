"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function RecentAuthenticationForm({ admin }: { admin: boolean }) {
  const router = useRouter();
  const search = useSearchParams();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/recent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: form.get("password"), code: admin ? form.get("code") : undefined }) });
    setBusy(false);
    if (!response.ok) return setError(response.status === 429 ? "Too many attempts. Try again later." : "The credentials were not accepted.");
    const requested = search.get("returnTo");
    const destination = requested?.startsWith("/") && !requested.startsWith("//") ? requested : admin ? "/admin/security" : "/dashboard";
    router.replace(destination); router.refresh();
  }
  return <form className="card grid gap-5 p-8" onSubmit={submit}><label className="label">Password<input className="input" name="password" type="password" required autoComplete="current-password"/></label>{admin && <label className="label">Authenticator or recovery code<input className="input" name="code" required maxLength={32} autoComplete="one-time-code"/></label>}{error && <p role="alert" className="text-red-700">{error}</p>}<button className="button" disabled={busy}>{busy ? "Confirming…" : "Confirm identity"}</button></form>;
}
