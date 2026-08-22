"use client";
import { useRouter } from "next/navigation";
import { DirectArtifactUploader } from "@/components/direct-artifact-uploader";
export function ReleaseArtifactControls({ versionId, artifactId, active }: { versionId?: string; artifactId?: string; active?: boolean }) { const router = useRouter(); if (versionId) return <DirectArtifactUploader versionId={versionId}/>; return <div className="flex gap-2">{active && <button className="rounded border border-red-600 px-2 py-1 text-xs text-red-700" onClick={async () => { if (!confirm("Remove this artifact from future downloads and release eligibility?")) return; const r = await fetch(`/api/admin/artifacts/${artifactId}`, { method: "DELETE" }); if (r.ok) router.refresh(); }}>Remove</button>}</div>; }
