"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function AdminLicenseOperations({ licenseId }: { licenseId: string }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [key, setKey] = useState("");
  const [accountId, setAccountId] = useState("");
  const [installationId, setInstallationId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [message, setMessage] = useState("");
  async function action(body: Record<string, unknown>, warning?: string) {
    if (warning && !confirm(warning)) return;
    const response = await fetch(`/api/admin/licenses/${licenseId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) { setMessage(result.error ?? "Action failed"); return; }
    if (result.licenseKey) setKey(result.licenseKey);
    setMessage("Completed");
    router.refresh();
  }
  return <>
    <button type="button" className="text-left text-xs font-bold text-[#3D75A7]" onClick={() => dialogRef.current?.showModal()}>Credential and transfer</button>
    <dialog ref={dialogRef} className="w-[min(92vw,32rem)] rounded-2xl p-0 shadow-2xl backdrop:bg-slate-950/40" onClose={() => setMessage("")}>
      <div className="card grid gap-4 p-6" role="document">
        <div><h2 className="text-xl font-black text-[#213A53]">License operations</h2><p className="mt-1 text-sm text-slate-600">Sensitive credentials and transfer controls are kept out of the table until needed.</p></div>
        <button type="button" className="text-left text-sm font-bold text-[#3D75A7]" onClick={() => action({ action: "REVEAL" }, "This will display sensitive license credential material. Continue?")}>Reveal license key</button>
        {key && <code className="max-w-full break-all rounded bg-amber-50 p-2 text-xs">{key}</code>}
        <div className="grid gap-2"><label className="text-sm font-bold text-[#213A53]">Transfer destination</label><input className="input py-2 text-sm" value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="Destination account ID"/><input className="input py-2 text-sm" value={installationId} onChange={(e) => setInstallationId(e.target.value)} placeholder="Target installation ID"/><input className="input py-2 text-sm" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} placeholder="Target device ID"/></div>
        <div className="flex justify-end gap-2"><button type="button" className="button" onClick={() => dialogRef.current?.close()}>Close</button><button type="button" className="rounded bg-[#213A53] px-3 py-2 text-sm font-bold text-white" onClick={() => action({ action: "TRANSFER", accountId, installationId, deviceId }, "Transfer this license and deactivate its previous commercial devices?")}>Transfer</button></div>
        {message && <small role="status" className="text-slate-700">{message}</small>}
      </div>
    </dialog>
  </>;
}
