"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export async function uploadArtifact(versionId: string, file: File, report?: (message: string) => void) {
  report?.("Authorizing direct upload…");
  const init = await fetch(`/api/admin/versions/${versionId}/artifacts/uploads`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filename: file.name, sizeBytes: file.size, contentType: file.type || "application/octet-stream" }) });
  if (!init.ok) throw new Error((await init.json()).error ?? "Upload authorization failed");
  const session = await init.json();
  report?.("Uploading directly to object storage…");
  const put = await fetch(session.uploadUrl, { method: "PUT", headers: { "content-type": session.contentType }, body: file });
  if (!put.ok) throw new Error("Object-storage upload failed");
  report?.("Verifying and scanning stored bytes…");
  const complete = await fetch(`/api/admin/versions/${versionId}/artifacts/uploads/${session.uploadId}/complete`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  if (!complete.ok) throw new Error((await complete.json()).error ?? "Artifact verification failed");
  report?.("Artifact verified");
}

export function DirectArtifactUploader({ versionId }: { versionId: string }) {
  const router = useRouter(); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  return <div className="mt-5 grid gap-2 rounded border border-blue-200 bg-blue-50 p-4"><p className="text-sm font-bold">Direct verified artifact upload</p><p className="text-xs text-slate-700">The installer uploads directly to private object storage; the application receives only metadata and verification requests.</p><input className="input" type="file" accept=".exe,.msi,.dmg,.pkg,.zip,.deb,.rpm,.appimage" disabled={busy} onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; setBusy(true); setMessage(""); try { await uploadArtifact(versionId, file, setMessage); router.refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "Upload failed"); } finally { setBusy(false); event.currentTarget.value = ""; } }} />{message && <p role="status" className="text-xs">{message}</p>}</div>;
}
