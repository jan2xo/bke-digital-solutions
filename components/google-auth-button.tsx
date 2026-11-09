"use client";

import { useState, type FormEvent, type ReactNode } from "react";

export function GoogleAuthButton(props: {
  readonly flow: "login" | "unified";
  readonly icon?: ReactNode;
  readonly formClassName?: string;
  readonly buttonClassName?: string;
  readonly returnTo?: string;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = { flow: props.flow, returnTo: props.returnTo };
      const response = await fetch("/api/auth/google/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok || typeof result.authorizationUrl !== "string") {
        setError(
          result.error === "RATE_LIMITED"
            ? "Too many attempts. Please wait before trying again."
            : result.error === "LEGAL_ACCEPTANCE_REQUIRED"
              ? "Review and accept each required document to continue."
              : "Google sign-in is temporarily unavailable.",
        );
        return;
      }
      window.location.assign(result.authorizationUrl);
    } catch {
      setError("Google sign-in is temporarily unavailable.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form method="post" onSubmit={submit} className={props.formClassName ?? "grid gap-5"}>
      {error && <p role="alert" className="text-sm font-semibold text-red-700">{error}</p>}
      <button className={props.buttonClassName ?? "button primary"} type="submit" disabled={busy}>
        {props.icon}
        {busy ? "Connecting to Google…" : props.flow === "unified" ? "Continue with Google" : "Sign in with Google"}
      </button>
    </form>
  );
}
