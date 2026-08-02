"use client";

import { FormEvent, useState } from "react";
import { PasswordInput } from "@/components/password-input";
import { useRouter } from "next/navigation";

export function AdminSecurityActions() {
  const router = useRouter();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [message, setMessage] = useState("");
  async function call(path: string) {
    const response = await fetch(path, { method: "POST" });
    if (response.status === 403) { router.push(`/security/recent?returnTo=${encodeURIComponent("/admin/security")}`); return null; }
    const body = await response.json();
    if (!response.ok) { setMessage(body.error ?? "The request failed."); return null; }
    return body;
  }
  async function regenerate() { if (!confirm("Replace every unused recovery code? Existing codes will stop working.")) return; const body = await call("/api/auth/mfa/recovery/regenerate"); if (body) setCodes(body.recoveryCodes); }
  async function disable() { if (!confirm("Disable MFA? Administrator access will be blocked until you enroll again.")) return; const body = await call("/api/auth/mfa/disable"); if (body) router.replace("/security/mfa"); }
  async function changePassword(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); const response = await fetch("/api/auth/password/change", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ currentPassword: values.get("currentPassword"), newPassword: values.get("newPassword") }) }); if (response.status === 403) return router.push(`/security/recent?returnTo=${encodeURIComponent("/admin/security")}`); if (!response.ok) return setMessage("Password change failed. Use at least 12 characters with upper/lowercase letters and a number."); form.reset(); setMessage("Password changed and all other sessions were revoked."); }
  return <div className="grid gap-6"><div className="card grid gap-4 p-6"><h2 className="text-xl font-bold">Recovery and MFA</h2><div className="flex flex-wrap gap-3"><button className="button" onClick={regenerate}>Regenerate recovery codes</button><button className="button-secondary" onClick={disable}>Disable and re-enroll MFA</button></div>{codes && <div><p className="font-bold">Save these codes now. They will not be shown again.</p><pre className="mt-2 overflow-auto rounded bg-slate-950 p-4 text-white">{codes.join("\n")}</pre></div>}</div><form className="card grid gap-4 p-6" onSubmit={changePassword}><h2 className="text-xl font-bold">Change password</h2><label className="label">Current password<PasswordInput name="currentPassword" required autoComplete="current-password"/></label><label className="label">New password<PasswordInput name="newPassword" minLength={12} required autoComplete="new-password"/></label><button className="button">Change password and revoke other sessions</button></form>{message && <p role="status">{message}</p>}</div>;
}
