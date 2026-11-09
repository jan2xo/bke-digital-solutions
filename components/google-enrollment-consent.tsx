"use client";

import { useState, type FormEvent } from "react";

type RequiredDocument = Readonly<{ title: string; slug: string; versionId: string }>;

export function GoogleEnrollmentConsent({ documents }: {
  readonly documents: readonly RequiredDocument[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function complete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const selected = new FormData(event.currentTarget).getAll("legalVersionIds");
      const response = await fetch("/api/auth/google/finish-registration", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ legalVersionIds: selected }),
      });
      const result: { error?: string; redirectTo?: string } = await response.json();
      if (!response.ok || !result.redirectTo) {
        setError(result.error === "LEGAL_ACCEPTANCE_REQUIRED"
          ? "Please accept both current legal documents to continue."
          : "Account creation could not be completed. Restart Continue with Google and try again.");
        return;
      }
      window.location.assign(result.redirectTo);
    } catch {
      setError("Account creation could not be completed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={complete} className="card grid gap-5 p-6">
      <fieldset className="grid gap-4" disabled={busy}>
        <legend className="mb-3 font-bold">Required agreements</legend>
        {documents.map((document) => (
          <label className="flex items-start gap-3 text-sm" key={document.versionId}>
            <input className="mt-1 size-4" type="checkbox" name="legalVersionIds" value={document.versionId} required />
            <span>
              I have read and agree to the{" "}
              <a href={`/legal/${document.slug}`} target="_blank" rel="noopener noreferrer"
                className="font-bold text-[#ffd15a] underline">{document.title}</a>.
            </span>
          </label>
        ))}
      </fieldset>
      {error && <p role="alert" className="text-sm font-semibold text-red-400">{error}</p>}
      <button type="submit" disabled={busy} className="button button-yellow">
        {busy ? "Creating your BKE account…" : "Accept and continue"}
      </button>
    </form>
  );
}
