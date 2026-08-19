"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type EvidenceKind = "SBOM" | "PROVENANCE" | "DEPENDENCIES" | "BACKUP" | "COMPLIANCE" | "MIGRATION";
type BackupOption = { id: string; verifiedAt: string | null };

export function ReleaseEvidenceControls({ versionId, blocked, backupOptions = [] }: { versionId: string; blocked: EvidenceKind[]; backupOptions?: BackupOption[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<EvidenceKind | null>(null);
  const [error, setError] = useState("");
  const [selectedBackup, setSelectedBackup] = useState("");
  const [scope, setScope] = useState("");
  const [attested, setAttested] = useState(false);
  async function record(kind: EvidenceKind, file: File | undefined) {
    if (!file) return;
    setBusy(kind); setError("");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const action = `RECORD_${kind}`;
      const response = await fetch("/api/admin/supply-chain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ versionId, action, reference: file.name, documentBase64: btoa(binary) }) });
      if (!response.ok) throw new Error("Evidence recording failed");
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Evidence recording failed"); }
    finally { setBusy(null); }
  }
  async function certifyBackup(backupId: string) { setBusy("BACKUP"); setError(""); try { const response = await fetch("/api/admin/supply-chain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ versionId, backupId, action: "CERTIFY_BACKUP" }) }); if (!response.ok) throw new Error("Backup certification failed"); router.refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Backup certification failed"); } finally { setBusy(null); } }
  async function certifyCompliance() { setBusy("COMPLIANCE"); setError(""); try { const response = await fetch("/api/admin/supply-chain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ versionId, action: "CERTIFY_COMPLIANCE", scope: scope || undefined, attestation: true }) }); if (!response.ok) throw new Error("Compliance certification failed"); router.refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Compliance certification failed"); } finally { setBusy(null); } }
  const backupBlocked = blocked.includes("BACKUP");
  const complianceBlocked = blocked.includes("COMPLIANCE");
  return <div className="mt-4 rounded border border-dashed p-4"><p className="text-sm font-bold">Record evidence</p><p className="mt-1 text-xs text-slate-600">Upload generated documents or certify an eligible verified backup. The server computes the current payload hash and validates all evidence.</p>{backupBlocked && <div className="mt-3 flex flex-wrap items-center gap-3"><select className="input" aria-label="Verified backup" value={selectedBackup} onChange={(event) => setSelectedBackup(event.target.value)}><option value="">Select verified backup</option>{backupOptions.map((backup) => <option key={backup.id} value={backup.id}>{backup.id} · verified {backup.verifiedAt ?? "unknown"}</option>)}</select><button className="rounded-lg border border-[#2D5579] px-3 py-1.5 text-xs font-bold text-[#213A53]" type="button" disabled={busy !== null || !selectedBackup} onClick={() => { void certifyBackup(selectedBackup); }}>{busy === "BACKUP" ? "Certifying…" : "Certify Backup for Release"}</button></div>}{complianceBlocked && <div className="mt-3 grid gap-2 rounded border p-3"><p className="text-xs text-slate-600">Commercial compliance certification uses the authenticated administrator account shown in the session. The server re-reads current published legal documents and binds certification to this release payload.</p><p className="text-sm font-semibold">Certified by: authenticated administrator</p><input className="input" aria-label="Compliance scope" placeholder="Review scope (optional)" value={scope} onChange={(event) => setScope(event.target.value)} /><label className="text-xs"><input type="checkbox" checked={attested} onChange={(event) => setAttested(event.target.checked)} /> I confirm that the required legal, privacy, tax, and retention reviews for this release have been completed.</label><button className="w-fit rounded-lg border border-[#2D5579] px-3 py-1.5 text-xs font-bold text-[#213A53]" type="button" disabled={busy !== null || !attested} onClick={() => { void certifyCompliance(); }}>{busy === "COMPLIANCE" ? "Certifying…" : "Certify Compliance"}</button></div>}{<div className="mt-3 flex flex-wrap gap-3">{blocked.filter((kind) => kind !== "BACKUP" && kind !== "COMPLIANCE").map((kind) => <label key={kind} className="rounded-lg border border-[#2D5579] px-3 py-1.5 text-xs font-bold text-[#213A53]">{busy === kind ? "Recording…" : `Upload ${kind}`}<input className="sr-only" type="file" onChange={(event) => { void record(kind, event.target.files?.[0]); event.currentTarget.value = ""; }} disabled={busy !== null}/></label>)}</div>}{error && <p className="mt-2 text-sm text-red-700">{error}</p>}</div>;
}
