"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  license: {
    id: string;
    productName: string;
    status: string;
    lastFour: string;
    expiresAt: string | null;
    maxDevices: number;
    activations: { id: string; label: string | null; active: boolean }[];
    downloads: { id: string; name: string; version: string }[];
  };
};

export function CustomerLicenseCard({ license }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [key, setKey] = useState("");
  const [message, setMessage] = useState("");

  async function reveal() {
    setMessage("");
    const response = await fetch(`/api/licenses/${license.id}/reveal`, { method: "POST" });
    const body = await response.json();
    if (response.ok) {
      setKey(body.licenseKey);
      return;
    }
    if (body.error === "UNAUTHENTICATED") {
      router.push(`/login?returnTo=${encodeURIComponent(pathname)}`);
      return;
    }
    setMessage(body.error === "LICENSE_KEY_UNAVAILABLE" ? "This license key is unavailable. Contact support." : "Unable to reveal the license key.");
  }

  async function deactivate(id: string) {
    const response = await fetch(`/api/devices/${id}/deactivate`, { method: "POST" });
    if (response.ok) router.refresh();
    else setMessage("Unable to deactivate device.");
  }

  return <article className="card p-6">
    <div className="flex justify-between gap-4">
      <div>
        <h3 className="text-xl font-black">{license.productName}</h3>
        <p className="text-sm text-slate-600">License •••• {license.lastFour} · {license.status}</p>
        {license.expiresAt && <p className="text-sm text-slate-600">Expires {new Date(license.expiresAt).toLocaleDateString()}</p>}
      </div>
      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">{license.activations.filter((activation) => activation.active).length}/{license.maxDevices} devices</span>
    </div>
    {key
      ? <div className="mt-4 rounded-lg bg-amber-50 p-4"><p className="text-xs font-bold uppercase">License key</p><code className="mt-2 block break-all">{key}</code></div>
      : <button className="button secondary mt-4" onClick={reveal}>Reveal license key</button>}
    <div className="mt-5 grid gap-2">{license.activations.map((activation) => <div className="flex items-center justify-between rounded-lg bg-slate-50 p-3 text-sm" key={activation.id}><span>{activation.label ?? "Authorized device"} · {activation.active ? "Active" : "Deactivated"}</span>{activation.active && <button className="font-bold text-red-700" onClick={() => deactivate(activation.id)}>Deactivate</button>}</div>)}</div>
    <div className="mt-5 flex flex-wrap gap-2">{license.downloads.map((download) => <a className="button" href={`/api/downloads/${download.id}`} key={download.id}>Download {download.version}</a>)}</div>
    {message && <p role="alert" className="mt-3 text-sm text-red-700">{message}</p>}
  </article>;
}
