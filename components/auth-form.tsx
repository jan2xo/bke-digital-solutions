"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { PasswordInput } from "@/components/password-input";

export function AuthForm({ mode, returnTo, legalDocuments = [] }: { mode: "login" | "register"; returnTo?: string; legalDocuments?: { type: string; title: string; slug: string; versionId: string }[] }) {
  const router = useRouter(); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);const[password,setPassword]=useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const formData = new FormData(event.currentTarget); const data = Object.fromEntries(formData); if(mode === "register") Object.assign(data,{legalVersionIds:formData.getAll("legalVersionIds")});
    const response = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
    const body = await response.json(); setBusy(false);
    if (!response.ok) return setError(body.error === "INVALID_CREDENTIALS" ? "The email or password is incorrect." : body.error === "ACCOUNT_EXISTS" ? "An account already exists for this email. Please sign in instead." : body.error === "RATE_LIMITED" ? "Too many attempts. Please wait before trying again." : mode === "register" ? "Check your name, email, and every password requirement below." : "Unable to continue. Please review your details.");
    router.push(mode === "login" ? body.mfaRequired ? "/login/mfa" : body.mfaEnrollmentRequired ? "/security/mfa" : body.reacceptanceRequired ? `/legal/accept?returnTo=${encodeURIComponent(returnTo ?? "/dashboard")}` : (returnTo ?? "/dashboard") : body.emailSent?"/verify-email":"/verify-email?delivery=failed"); router.refresh();
  }
  return <form method="post" onSubmit={submit} className="card grid gap-5 p-8">
    {mode === "register" && <label className="label">Full name<input className="input" name="name" required minLength={2} maxLength={100} autoComplete="name" /></label>}
    <label className="label">{mode === "login" ? "Email" : "Email address"}<input className="input" type="email" name="email" required autoComplete="email" aria-label={mode === "login" ? "Email address" : undefined} /></label>
    <label className="label">Password<PasswordInput name="password" required minLength={mode === "register" ? 12 : 1} maxLength={128} autoComplete={mode === "register" ? "new-password" : "current-password"} aria-describedby={mode==="register"?"password-requirements":undefined} value={password} onChange={e=>setPassword(e.target.value)} /></label>
    {mode === "register" && <div id="password-requirements" className="rounded-lg border border-[#2D5579]/30 bg-[#3D75A7]/5 p-4 text-sm"><p className="font-bold text-[#213A53]">Your password must include:</p><ul className="mt-2 grid gap-1 sm:grid-cols-2"><Requirement met={password.length>=12}>12 or more characters</Requirement><Requirement met={/[A-Z]/.test(password)}>One uppercase letter</Requirement><Requirement met={/[a-z]/.test(password)}>One lowercase letter</Requirement><Requirement met={/[0-9]/.test(password)}>One number</Requirement></ul></div>}
    {mode === "register" && <fieldset className="grid gap-3"><legend className="font-bold">Legal acknowledgements</legend>{legalDocuments.map((document) => <label className="flex items-start gap-2 text-sm" key={document.versionId}><input className="mt-1" type="checkbox" name="legalVersionIds" value={document.versionId} required/><span>{document.type === "TERMS_OF_SERVICE" ? "I agree to" : "I acknowledge"} the <a className="font-bold text-[#3D75A7] underline" href={`/legal/${document.slug}`} target="_blank" rel="noopener noreferrer">{document.title}</a>.</span></label>)}</fieldset>}
    {error && <p role="alert" className="text-sm font-semibold text-red-700">{error}</p>}
    <button disabled={busy} className="button" type="submit">{busy ? "Please wait…" : mode === "login" ? "Sign In" : "Create account"}</button>
  </form>;
}
function Requirement({met,children}:{met:boolean;children:React.ReactNode}){return <li className={met?"font-semibold text-green-700":"text-slate-600"}><span aria-hidden="true">{met?"✓":"○"}</span> {children}</li>}
