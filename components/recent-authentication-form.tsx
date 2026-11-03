"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function RecentAuthenticationForm({ admin, returnTo }: { admin: boolean; returnTo: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [codeSent, setCodeSent] = useState(false);

  async function requestCode() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/auth/mfa/challenge/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ purpose: "RECENT_AUTH" }),
      });
      const body = await response.json();
      if (!response.ok) {
        setCodeSent(false);
        setError(response.status === 429
          ? "Please wait before requesting another code."
          : "Unable to request a verification challenge.");
        return;
      }
      setCodeSent(true);
      if (body.emailSent === false) {
        setError(admin
          ? "Email delivery failed. Use a saved recovery code if one is available."
          : "Email delivery failed. Request a new code later.");
        return;
      }
      setMessage("A verification code was sent to your registered BKE email address.");
    } catch {
      setError("Unable to request a verification challenge.");
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/recent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: form.get("code") }),
      });
      if (!response.ok) {
        setError(response.status === 429
          ? "Too many attempts. Try again later."
          : "The verification code was not accepted.");
        return;
      }
      const requested = returnTo;
      const destination =
        requested?.startsWith("/") && !requested.startsWith("//")
          ? requested
          : admin ? "/admin/security" : "/dashboard";
      router.replace(destination);
      router.refresh();
    } catch {
      setError("The verification could not be completed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card grid gap-5 p-8">
      {!codeSent ? (
        <button className="button-secondary" type="button" disabled={busy} onClick={requestCode}>
          Email me a verification code
        </button>
      ) : (
        <form className="grid gap-5" onSubmit={submit}>
          <label className="label">
            Verification code or recovery code
            <input className="input" name="code" required maxLength={32} autoComplete="one-time-code" />
          </label>
          {message && <p role="status" className="text-green-700">{message}</p>}
          {error && <p role="alert" className="text-red-700">{error}</p>}
          <button className="button" disabled={busy}>
            {busy ? "Confirming…" : "Confirm identity"}
          </button>
          <button className="text-left text-sm font-bold text-[#3D75A7]" type="button" disabled={busy} onClick={requestCode}>
            Email a new code
          </button>
        </form>
      )}
      {!codeSent && error && <p role="alert" className="text-red-700">{error}</p>}
      {!codeSent && message && <p role="status" className="text-green-700">{message}</p>}
    </div>
  );
}
