"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function AuthForm({ mode, returnTo }: { mode: "login" | "register"; returnTo?: string }) {
  const router = useRouter(); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);const[password,setPassword]=useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
    const body = await response.json(); setBusy(false);
    if (!response.ok) return setError(body.error === "INVALID_CREDENTIALS" ? "The email or password is incorrect." : body.error === "ACCOUNT_EXISTS" ? "An account already exists for this email. Please sign in instead." : body.error === "RATE_LIMITED" ? "Too many attempts. Please wait before trying again." : mode === "register" ? "Check your name, email, and every password requirement below." : "Unable to continue. Please review your details.");
    router.push(mode === "login" ? body.mfaRequired ? "/login/mfa" : body.mfaEnrollmentRequired ? "/security/mfa" : (returnTo ?? "/dashboard") : body.emailSent?"/verify-email":"/verify-email?delivery=failed"); router.refresh();
  }
  return <form method="post" onSubmit={submit} className="card grid gap-5 p-8">
    {mode === "register" && <label className="label">Full name<input className="input" name="name" required minLength={2} maxLength={100} autoComplete="name" /></label>}
    <label className="label">Email address<input className="input" type="email" name="email" required autoComplete="email" /></label>
    <label className="label">Password<input className="input" type="password" name="password" required minLength={mode === "register" ? 12 : 1} maxLength={128} autoComplete={mode === "register" ? "new-password" : "current-password"} aria-describedby={mode==="register"?"password-requirements":undefined} value={password} onChange={e=>setPassword(e.target.value)} /></label>
    {mode === "register" && <div id="password-requirements" className="rounded-lg border border-[#2D5579]/30 bg-[#3D75A7]/5 p-4 text-sm"><p className="font-bold text-[#213A53]">Your password must include:</p><ul className="mt-2 grid gap-1 sm:grid-cols-2"><Requirement met={password.length>=12}>12 or more characters</Requirement><Requirement met={/[A-Z]/.test(password)}>One uppercase letter</Requirement><Requirement met={/[a-z]/.test(password)}>One lowercase letter</Requirement><Requirement met={/[0-9]/.test(password)}>One number</Requirement></ul></div>}
    {error && <p role="alert" className="text-sm font-semibold text-red-700">{error}</p>}
    <button disabled={busy} className="button" type="submit">{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button>
  </form>;
}
function Requirement({met,children}:{met:boolean;children:React.ReactNode}){return <li className={met?"font-semibold text-green-700":"text-slate-600"}><span aria-hidden="true">{met?"✓":"○"}</span> {children}</li>}
