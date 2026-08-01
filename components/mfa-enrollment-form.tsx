"use client";
/* A generated data URL is private enrollment material and must not pass through an image optimizer. */
/* eslint-disable @next/next/no-img-element */

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type Setup = { secret: string; otpauthUri: string; qrDataUrl: string; issuer: string; accountLabel: string };

export function MfaEnrollmentForm() {
  const router = useRouter();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState("");

  async function begin() {
    setError("");
    const response = await fetch("/api/auth/mfa/enroll", { method: "POST" });
    const body = await response.json();
    if (!response.ok) return setError(body.error === "RECENT_AUTH_REQUIRED" ? "Sign in again before starting MFA enrollment." : "Unable to start enrollment.");
    setSetup(body);
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/mfa/enroll/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: form.get("code") }) });
    const body = await response.json();
    if (!response.ok) return setError("The code did not match. Check your device clock and try again.");
    setCodes(body.recoveryCodes);
  }

  if (codes) return <div className="card p-8"><h2 className="text-2xl font-bold">Save your recovery codes now</h2><p className="my-3">Each code works once. They will not be displayed again.</p><pre className="overflow-auto rounded bg-slate-950 p-4 text-white">{codes.join("\n")}</pre><button className="button mt-5" onClick={() => { router.replace("/admin/security"); router.refresh(); }}>I saved these codes</button></div>;

  return <div className="card grid gap-5 p-8">{!setup ? <><p>MFA is mandatory for administrators. Set it up before accessing administration.</p><button className="button" onClick={begin}>Begin secure setup</button></> : <><p>Scan this QR code with your authenticator app, or enter the manual key.</p><img src={setup.qrDataUrl} alt="Authenticator enrollment QR code" width={240} height={240}/><p><strong>Issuer:</strong> {setup.issuer}<br/><strong>Account:</strong> {setup.accountLabel}</p><code className="break-all rounded bg-slate-100 p-3">{setup.secret}</code><details><summary>Authenticator URI</summary><code className="break-all">{setup.otpauthUri}</code></details><form className="grid gap-4" onSubmit={verify}><label className="label">Six-digit code<input className="input" name="code" required pattern="[0-9]{6}" inputMode="numeric" autoComplete="one-time-code"/></label><button className="button">Enable MFA</button></form></>}{error && <p role="alert" className="text-red-700">{error}</p>}</div>;
}
