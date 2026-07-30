"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminProductDelete } from "@/components/admin-product-delete";
import { AdminProductEditor } from "@/components/admin-product-editor";

type Product = {
  id: string; name: string; slug: string; summary: string; description: string; category: string;
  licenseType: string; featured: boolean; tags: string[]; active: boolean; archivedAt: string | null;
  prices: { amountMinor: number; billingType: string }[];
  versions: { id: string; version: string; active: boolean; isLatest: boolean; operatingSystem: string; architecture: string }[];
};

export function AdminProductManager({ products }: { products: Product[] }) {
  const router = useRouter();
  const [error, setError] = useState("");

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = event.currentTarget;
    const fields = new FormData(form);
    const billingType = fields.get("billingType");
    const body = {
      slug: fields.get("slug"), name: fields.get("name"), summary: fields.get("summary"), description: fields.get("description"),
      category: fields.get("category"), licenseType: fields.get("licenseType"),
      tags: String(fields.get("tags") ?? "").split(",").map((value) => value.trim()).filter(Boolean),
      featured: fields.get("featured") === "on", type: "SOFTWARE", priceName: "Standard license",
      amountMinor: Math.round(Number(fields.get("price")) * 100), billingType,
      maxSeats: Number(fields.get("maxSeats")), maxDevicesPerSeat: Number(fields.get("maxDevices")),
      ...(billingType === "SUBSCRIPTION" ? { intervalUnit: "YEAR", intervalCount: 1 } : {}),
    };
    const response = await fetch("/api/admin/products", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) { setError((await response.json()).error ?? "Unable to create product"); return; }
    form.reset();
    router.refresh();
  }

  async function action(id: string, actionName: string) {
    const response = await fetch(`/api/admin/products/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: actionName }) });
    if (!response.ok) setError("Product update failed");
    router.refresh();
  }

  async function upload(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const response = await fetch(`/api/admin/products/${id}/versions`, { method: "POST", body: new FormData(form) });
    if (!response.ok) { setError((await response.json()).error ?? "Upload failed"); return; }
    form.reset();
    router.refresh();
  }

  return <div className="grid gap-8">
    <form onSubmit={create} className="card grid gap-4 p-6 md:grid-cols-2">
      <h2 className="text-2xl font-black md:col-span-2">Create product</h2>
      <Field name="name" label="Name"/><Field name="slug" label="Slug" pattern="[a-z0-9-]+"/>
      <Field name="category" label="Category"/><Field name="licenseType" label="License type"/>
      <Field name="tags" label="Tags (comma separated)" wide/><Field name="summary" label="Short description" wide/>
      <label className="label md:col-span-2">Long description<textarea className="input min-h-28" name="description" minLength={10} required/></label>
      <Field name="price" label="Price (PHP)" type="number"/>
      <label className="label">Billing<select className="input" name="billingType"><option value="ONE_TIME">One time</option><option value="SUBSCRIPTION">Annual subscription</option></select></label>
      <Field name="maxSeats" label="Seats" type="number" defaultValue="1"/><Field name="maxDevices" label="Devices per seat" type="number" defaultValue="1"/>
      <label className="flex items-center gap-2"><input type="checkbox" name="featured"/> Featured product</label>
      {error && <p role="alert" className="text-red-700 md:col-span-2">{error}</p>}
      <button className="button md:col-span-2">Create draft product</button>
    </form>
    {products.map((product) => <section className="card p-6" key={product.id}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-bold uppercase text-[#3D75A7]">{product.active ? "Published" : product.archivedAt ? "Archived" : "Draft"}{product.featured ? " · Featured" : ""}</p>
          <h2 className="text-2xl font-black">{product.name}</h2>
          <p className="text-sm text-slate-600">/{product.slug} · {product.category} · {product.prices[0] ? `₱${(product.prices[0].amountMinor / 100).toLocaleString("en-PH")}` : "No price"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {product.archivedAt ? <><button type="button" className="button secondary" onClick={() => action(product.id, "RESTORE")}>Restore</button><AdminProductDelete productId={product.id} productName={product.name}/></> : <>
            <button type="button" className="button secondary" onClick={() => action(product.id, product.active ? "UNPUBLISH" : "PUBLISH")}>{product.active ? "Unpublish" : "Publish"}</button>
            <button type="button" className="button secondary" onClick={() => action(product.id, "ARCHIVE")}>Archive</button>
          </>}
        </div>
      </div>
      <AdminProductEditor product={{ ...product, amountMinor: product.prices[0]?.amountMinor ?? 100 }}/>
      <div className="mt-5 grid gap-2">{product.versions.map((version) => <p className="rounded-lg bg-slate-50 p-3 text-sm" key={version.id}>{version.version} · {version.operatingSystem} {version.architecture} · {version.active ? "Published" : "Draft"}{version.isLatest ? " · Latest" : ""}</p>)}</div>
      <form onSubmit={(event) => upload(event, product.id)} className="mt-6 grid gap-3 border-t pt-5 md:grid-cols-3">
        <Field name="version" label="Semantic version"/>
        <label className="label">Operating system<select className="input" name="operatingSystem"><option>Windows</option><option>macOS</option><option>Linux</option></select></label>
        <label className="label">Architecture<select className="input" name="architecture"><option>x64</option><option>arm64</option><option>universal</option></select></label>
        <label className="label md:col-span-2">Release notes<textarea className="input" name="releaseNotes"/></label>
        <label className="label">Installer<input className="input" type="file" name="installer" accept=".exe,.msi,.dmg,.pkg,.zip,.deb,.AppImage" required/></label>
        <label className="flex items-center gap-2"><input type="checkbox" name="publish" value="true"/> Publish now</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="latest" value="true"/> Mark latest</label>
        <button className="button">Upload version</button>
      </form>
    </section>)}
  </div>;
}

function Field({ name, label, type = "text", wide = false, pattern, defaultValue }: { name: string; label: string; type?: string; wide?: boolean; pattern?: string; defaultValue?: string }) {
  const initial = defaultValue ?? (name === "category" ? "General" : name === "licenseType" ? "Commercial" : undefined);
  return <label className={`label ${wide ? "md:col-span-2" : ""}`}>{label}<input className="input" name={name} type={type} pattern={pattern} defaultValue={initial} min={type === "number" ? "1" : undefined} minLength={type === "text" && name !== "tags" ? 2 : undefined} required={name !== "tags"}/></label>;
}
