"use client";

import { FormEvent, useState } from "react";

type LegalDocument = {
  readonly title: string;
  readonly slug: string;
  readonly versionId: string;
};

export function GoogleAuthButton(props: {
  readonly flow: "login" | "register";
  readonly returnTo?: string;
  readonly legalDocuments?: readonly LegalDocument[];
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      const body = props.flow === "register"
        ? { flow: "register", legalVersionIds: form.getAll("legalVersionIds") }
        : { flow: "login", returnTo: props.returnTo };
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
    <form method="post" onSubmit={submit} className="grid gap-5">
      {props.flow === "register" && (
        <fieldset className="legal-consent-panel grid gap-3">
          <legend className="px-2 font-bold">Review and accept before continuing</legend>
          <p className="text-sm text-slate-600">
            Open each document, read it, then select every checkbox to create your account.
          </p>
          {props.legalDocuments?.map((document) => (
            <label className="flex items-start gap-2 text-sm" key={document.versionId}>
              <input className="mt-1 size-4" type="checkbox" name="legalVersionIds" value={document.versionId} required />
              <span>
                I have read and agree to the{" "}
                <a className="font-bold text-[#3D75A7] underline" href={`/legal/${document.slug}`} target="_blank" rel="noopener noreferrer">
                  {document.title}
                </a>.
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {error && <p role="alert" className="text-sm font-semibold text-red-700">{error}</p>}
      <button className="button primary" type="submit" disabled={busy}>
        {busy ? "Connecting to Google…" : props.flow === "register" ? "Continue with Google" : "Sign in with Google"}
      </button>
    </form>
  );
}
