"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter(); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
    const body = await response.json(); setBusy(false);
    if (!response.ok) return setError(body.error === "INVALID_CREDENTIALS" ? "The email or password is incorrect." : "Unable to continue. Please review your details.");
    router.push(mode === "login" ? "/dashboard" : "/verify-email"); router.refresh();
  }
  return <form onSubmit={submit} className="card grid gap-5 p-8">
    {mode === "register" && <label className="label">Full name<input className="input" name="name" required minLength={2} maxLength={100} autoComplete="name" /></label>}
    <label className="label">Email address<input className="input" type="email" name="email" required autoComplete="email" /></label>
    <label className="label">Password<input className="input" type="password" name="password" required minLength={mode === "register" ? 12 : 1} maxLength={128} autoComplete={mode === "register" ? "new-password" : "current-password"} /></label>
    {error && <p role="alert" className="text-sm font-semibold text-red-700">{error}</p>}
    <button disabled={busy} className="button" type="submit">{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button>
  </form>;
}
