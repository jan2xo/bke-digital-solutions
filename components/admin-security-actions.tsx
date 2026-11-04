"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AdminSecurityActions() {
  const router = useRouter();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function call(path: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(path, { method: "POST" });
      const body = await response.json();
      if (response.status === 403) {
        router.push(`/security/recent?returnTo=${encodeURIComponent("/admin/security")}`);
        return null;
      }
      if (!response.ok) {
        setMessage(body.error ?? "The request failed.");
        return null;
      }
      return body;
    } finally {
      setBusy(false);
    }
  }

  async function regenerate() {
    if (!confirm("Replace every unused recovery code? Existing codes will stop working.")) return;
    const result = await call("/api/auth/mfa/recovery/regenerate");
    if (result) {
      setCodes(result.recoveryCodes);
      setAcknowledged(false);
    }
  }

  function download() {
    if (!codes) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([codes.join("\n")], { type: "text/plain" }));
    link.download = "bke-recovery-codes.txt";
    link.click();
  }

  async function disable() {
    if (!confirm("Disable administrator email verification? Access will be blocked until you verify it again.")) return;
    const result = await call("/api/auth/mfa/disable");
    if (result) router.replace("/security/mfa");
  }

  return (
    <div className="grid gap-6">
      <div className="card grid gap-4 p-6">
        <h2 className="text-xl font-bold">Recovery and email verification</h2>
        <div className="flex gap-3">
          <button className="button" onClick={regenerate} disabled={busy}>Regenerate recovery codes</button>
          <button className="button-secondary" onClick={disable} disabled={busy}>Disable and verify email again</button>
        </div>
        {codes && (
          <div>
            <p className="font-bold">Save these codes now. They will not be shown again.</p>
            <pre className="mt-2 overflow-auto rounded bg-slate-950 p-4 text-white">{codes.join("\n")}</pre>
            <div className="mt-3 flex gap-2">
              <button className="button-secondary" onClick={() => navigator.clipboard.writeText(codes.join("\n"))}>Copy codes</button>
              <button className="button-secondary" onClick={download}>Download codes</button>
            </div>
            <label className="mt-3 block">
              <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
              {" "}I saved these codes securely.
            </label>
            <p className="text-sm">Acknowledgement is required before leaving this screen.</p>
          </div>
        )}
      </div>
      <p className="card p-6 text-slate-600">
        BKE Digital Solutions sign-in uses Google. Password changes are not available here.
      </p>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
