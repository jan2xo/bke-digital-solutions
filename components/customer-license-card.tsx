"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

export type MySoftwareCardProps = {
  license: Readonly<{
    id: string;
    productName: string;
    editionName: string | null;
    planName: string;
    status: string;
    subscriptionStatus: string | null;
    accountLifecycle: string;
    periodThrough: string | null;
    maxDevices: number;
    activeDevices: number;
    maxSeats: number;
    assignedSeats: number;
    activations: readonly { id: string; label: string | null; active: boolean }[];
    canManageDevices: boolean;
    manageSeatsHref: string | null;
  }>;
  renewalAction?: ReactNode;
};

export function CustomerLicenseCard({ license, renewalAction }: MySoftwareCardProps) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const accountActive = license.accountLifecycle === "ACTIVE";
  const displayStatus = accountActive ? license.status : `ACCOUNT ${license.accountLifecycle}`;
  const badgeClass = accountActive && license.status === "ACTIVE"
    ? "border-emerald-700/60 bg-emerald-950/50 text-emerald-300"
    : "border-amber-700/60 bg-amber-950/50 text-amber-300";

  async function deactivate(id: string) {
    if (!accountActive || !license.canManageDevices) return;
    setMessage("");
    try {
      const response = await fetch(`/api/devices/${encodeURIComponent(id)}/deactivate`, { method: "POST" });
      if (response.ok) router.refresh();
      else setMessage("Unable to deactivate this device.");
    } catch {
      setMessage("Unable to contact the device management service.");
    }
  }

  return <article className="card min-w-0 p-5 md:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-wider text-[#ffd15a]">{license.planName}</p>
        <h3 className="mt-1 text-xl font-black text-white">{license.productName}{license.editionName ? ` — ${license.editionName}` : ""}</h3>
      </div>
      <span className={`rounded-full border px-3 py-1 text-xs font-bold ${badgeClass}`}>{displayStatus}</span>
    </div>
    <div className="mt-4 grid grid-cols-1 gap-2 text-sm text-slate-300 sm:grid-cols-2">
      <div className="rounded-lg border border-slate-700/70 bg-slate-900/60 px-3 py-2">
        <p className="text-xs text-slate-400">Authorized devices</p>
        <p className="font-bold text-white">{license.activeDevices} / {license.maxDevices}</p>
      </div>
      <div className="rounded-lg border border-slate-700/70 bg-slate-900/60 px-3 py-2">
        <p className="text-xs text-slate-400">Assigned seats</p>
        <p className="font-bold text-white">{license.assignedSeats} / {license.maxSeats}</p>
      </div>
    </div>
    {license.periodThrough
      ? <p className="mt-3 text-sm text-slate-300">{license.subscriptionStatus ? "Current period through" : "Access through"} <time dateTime={license.periodThrough}>{new Date(license.periodThrough).toLocaleDateString("en-PH", { timeZone: "Asia/Manila" })}</time></p>
      : <p className="mt-3 text-sm text-slate-400">{license.planName === "Perpetual" ? "Perpetual license" : "No access end date recorded"}</p>}
    {license.subscriptionStatus && license.subscriptionStatus !== license.status &&
      <p className="mt-1 text-sm text-amber-300">Subscription status: {license.subscriptionStatus}</p>}
    <p className="mt-4 text-sm leading-6 text-slate-300">Install and manage your entitled software using the BKE desktop app. Sign in with your BKE account.</p>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <a className="button button-yellow" href="/bke">Get BKE</a>
      {license.manageSeatsHref && <a className="button secondary" href={license.manageSeatsHref}>Manage seats</a>}
    </div>
    {renewalAction}
    {license.activations.length > 0 && <div className="mt-5 border-t border-slate-700 pt-4">
      <h4 className="text-sm font-bold text-white">Devices</h4>
      <ul className="mt-2 grid gap-2">
        {license.activations.map((activation) =>
          <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-800/70 px-3 py-2 text-sm" key={activation.id}>
            <span className="text-slate-200">{activation.label ?? "Authorized device"} · {activation.active ? "Active" : "Deactivated"}</span>
            {activation.active && accountActive && license.canManageDevices &&
              <button className="font-bold text-rose-300 hover:text-rose-200" type="button" onClick={() => deactivate(activation.id)}>Deactivate</button>}
          </li>)}
      </ul>
    </div>}
    {message && <p role="alert" className="mt-3 text-sm text-rose-300">{message}</p>}
  </article>;
}
