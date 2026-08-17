"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type EvidenceKind = "SBOM" | "PROVENANCE" | "DEPENDENCIES" | "BACKUP" | "COMPLIANCE" | "MIGRATION";

export function ReleaseEvidenceControls({ versionId, blocked }: { versionId: string; blocked: EvidenceKind[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<EvidenceKind | null>(null);
  const [error, setError] = useState("");
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
  return <div className="mt-4 rounded border border-dashed p-4"><p className="text-sm font-bold">Record evidence</p><p className="mt-1 text-xs text-slate-600">Upload the generated document. The server computes the current payload hash, verifies the document bytes, stores them privately, and refreshes readiness.</p><div className="mt-3 flex flex-wrap gap-3">{blocked.map((kind) => <label key={kind} className="rounded-lg border border-[#2D5579] px-3 py-1.5 text-xs font-bold text-[#213A53]">{busy === kind ? "Recording…" : `Upload ${kind}`}<input className="sr-only" type="file" onChange={(event) => { void record(kind, event.target.files?.[0]); event.currentTarget.value = ""; }} disabled={busy !== null}/></label>)}</div>{error && <p className="mt-2 text-sm text-red-700">{error}</p>}</div>;
}
