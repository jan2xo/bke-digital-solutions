"use client";
import { useState } from "react";

export function RecentAuthenticationForm({ returnTo }: { returnTo: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function confirm() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/google/start", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ flow: "reauthenticate", returnTo }),
      });
      const result = await response.json();
      if (!response.ok || typeof result.authorizationUrl !== "string") throw new Error();
      window.location.assign(result.authorizationUrl);
    } catch {
      setError("Unable to start Google confirmation. Try again later.");
      setBusy(false);
    }
  }
  return <div className="card grid gap-5 p-8">
    <button className="button" disabled={busy} onClick={confirm}>
      {busy ? "Opening Google…" : "Continue with Google"}
    </button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
