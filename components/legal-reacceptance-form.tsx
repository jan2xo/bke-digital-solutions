"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function LegalReacceptanceForm({ documents, returnTo }: { documents: { versionId: string; title: string; slug: string }[]; returnTo: string }) {
  const router = useRouter();
  const panel = useRef<HTMLDivElement>(null);
  const [accepted, setAccepted] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (accepted.length !== documents.length) {
      setError("Please review and accept each required document before continuing.");
      panel.current?.focus();
      return;
    }
    setBusy(true); setError("");
    const response = await fetch("/api/legal/accept", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ versionIds: accepted }) });
    if (!response.ok) { setError("Accept every updated document before continuing."); setBusy(false); return; }
    router.push(returnTo); router.refresh();
  }

  return <div ref={panel} tabIndex={-1} className="legal-consent-panel mt-8 grid gap-4 outline-none" data-invalid={Boolean(error) || undefined}>
    <div><h2 className="font-black">Review and accept before continuing</h2><p className={`mt-1 text-sm ${error ? "font-semibold text-red-700" : "text-slate-600"}`}>{error || "Open and read each updated document, then select every checkbox."}</p></div>
    {documents.map(document => <label className="flex items-start gap-3" key={document.versionId}><input className="mt-1 size-4" type="checkbox" checked={accepted.includes(document.versionId)} onChange={event => { setAccepted(items => event.target.checked ? [...items, document.versionId] : items.filter(id => id !== document.versionId)); setError(""); }}/><span>I have read and agree to the updated <a className="font-bold text-[#3D75A7] underline" href={`/legal/${document.slug}`} target="_blank" rel="noopener noreferrer">{document.title}</a>.</span></label>)}
    <button className="button" disabled={busy} data-incomplete={accepted.length !== documents.length || undefined} onClick={submit}>{busy ? "Recording acceptance…" : "Accept and continue"}</button>
  </div>;
}
