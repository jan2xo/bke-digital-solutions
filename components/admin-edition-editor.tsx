"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type Plan = { id: string; type: "PERPETUAL" | "MONTHLY" | "ANNUAL"; amountMinor: number | null; listAmountMinor: number | null; active: boolean };
type Edition = { id: string; name: string; slug: string; description: string | null; features: unknown; maxUsers: number; maxDevicesPerUser: number; updatePolicy: "LIFETIME" | "ACTIVE_TERM" | "MAJOR_VERSION"; active: boolean; purchasePlans: Plan[] };

export function AdminEditionEditor({ edition }: { edition: Edition }) {
  const router = useRouter();
  const plan = (type: Plan["type"]) => edition.purchasePlans.find((item) => item.type === type);
  const perpetual = plan("PERPETUAL"); const monthly = plan("MONTHLY"); const annual = plan("ANNUAL");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setError(""); const fields = new FormData(event.currentTarget); const body = editionBody(fields); const response = await fetch(`/api/admin/editions/${edition.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); if (!response.ok) { const payload = await response.json(); setError(payload.error ?? "Unable to update edition"); setBusy(false); return; } setBusy(false); router.refresh(); }
  return <form onSubmit={save} className="mt-5 rounded-xl border border-slate-200 p-4">
    <div className="grid gap-3 md:grid-cols-2"><Field name="editionName" label="Edition name" value={edition.name}/><Field name="editionSlug" label="Edition slug" value={edition.slug}/><Field name="editionDescription" label="Edition description" value={edition.description ?? ""}/><Field name="features" label="Features (comma separated)" value={Array.isArray(edition.features) ? edition.features.join(", ") : ""}/><Field name="maxUsers" label="Authorized users" value={String(edition.maxUsers)} type="number"/><Field name="maxDevices" label="Devices per user" value={String(edition.maxDevicesPerUser)} type="number"/><label className="label">Update policy<select className="input" name="updatePolicy" defaultValue={edition.updatePolicy}><option value="LIFETIME">Lifetime updates</option><option value="ACTIVE_TERM">While subscription is active</option><option value="MAJOR_VERSION">Current major version</option></select></label><label className="flex items-center gap-2"><input type="checkbox" name="editionActive" defaultChecked={edition.active}/> Edition visible</label></div>
    <div className="mt-5 grid gap-4 border-t pt-5 md:grid-cols-3">
      <PlanToggle name="perpetualEnabled" label="Perpetual" checked={perpetual?.active ?? false}><PriceFields prefix="perpetual" plan={perpetual}/></PlanToggle>
      <PlanToggle name="monthlyEnabled" label="Monthly" checked={monthly?.active ?? false}><PriceFields prefix="monthly" plan={monthly}/></PlanToggle>
      <PlanToggle name="annualEnabled" label="Annual" checked={annual?.active ?? false}><PriceFields prefix="annual" plan={annual}/></PlanToggle>
    </div>
    {error && <p className="mt-3 text-red-700" role="alert">{error}</p>}<button className="button mt-4" disabled={busy}>{busy ? "Saving plans…" : "Save edition and plans"}</button>
  </form>;
}

export function editionBody(fields: FormData) {
  const enabled = (name: string) => fields.get(name) === "on";
  const amount = (name: string) => Math.round(Number(fields.get(name)) * 100);
  const plan = (prefix: string) => ({ enabled: enabled(`${prefix}Enabled`), amountMinor: amount(`${prefix}SalePrice`), listAmountMinor: amount(`${prefix}ListPrice`) });
  return { name: fields.get("editionName"), slug: fields.get("editionSlug"), description: fields.get("editionDescription"), features: String(fields.get("features") ?? "").split(",").map((feature) => feature.trim()).filter(Boolean), maxUsers: Number(fields.get("maxUsers")), maxDevicesPerUser: Number(fields.get("maxDevices")), updatePolicy: fields.get("updatePolicy"), active: enabled("editionActive"), plans: { perpetual: plan("perpetual"), monthly: plan("monthly"), annual: plan("annual") } };
}
function PriceFields({ prefix, plan }: { prefix: string; plan?: Plan }) { const sale = (plan?.amountMinor ?? 100) / 100; const list = (plan?.listAmountMinor ?? plan?.amountMinor ?? 100) / 100; return <><Field name={`${prefix}ListPrice`} label="List price (PHP)" value={String(list)} type="number"/><Field name={`${prefix}SalePrice`} label="Selling price (PHP)" value={String(sale)} type="number"/></>; }
function PlanToggle({ name, label, checked, children }: { name: string; label: string; checked: boolean; children: React.ReactNode }) { return <fieldset className="rounded-lg bg-slate-800 p-4 text-slate-100"><label className="mb-3 flex items-center gap-2 font-black"><input type="checkbox" name={name} defaultChecked={checked}/> {label}</label><div className="grid gap-2">{children}</div></fieldset>; }
function Field({ name, label, value, type = "text" }: { name: string; label: string; value: string; type?: string }) { return <label className="label">{label}<input className="input" name={name} type={type} defaultValue={value} min={type === "number" ? "1" : undefined} step={type === "number" ? "0.01" : undefined} required/></label>; }
