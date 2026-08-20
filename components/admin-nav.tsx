"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const groups = [
  { label: "Workspace", links: [["Overview", "/admin"], ["Observability", "/admin/observability"]] },
  { label: "Catalog & Releases", links: [["Products", "/admin/products"], ["Offers", "/admin/offers"], ["Releases", "/admin/releases"], ["Supply Chain", "/admin/supply-chain"], ["Artifacts", "/admin/artifacts"]] },
  { label: "Customers & Access", links: [["Customers", "/admin/customers"], ["Subscriptions", "/admin/subscriptions"], ["Trials", "/admin/trials"], ["Licenses", "/admin/licenses"], ["Devices", "/admin/devices"]] },
  { label: "Commerce", links: [["Orders", "/admin/orders"], ["Payments", "/admin/payments"], ["Invoices", "/admin/invoices"], ["Records", "/admin/records"]] },
  { label: "Operations", links: [["Scheduler", "/admin/scheduler"], ["Backups", "/admin/backups"], ["Scanner", "/admin/scanner"], ["Providers", "/admin/providers"]] },
  { label: "Governance", links: [["Legal & Compliance", "/admin/legal"], ["Compliance Review", "/admin/compliance"], ["Site Content", "/admin/site-content"], ["Audit", "/admin/audit"]] },
  { label: "Security", links: [["Security", "/admin/security"], ["Signing Keys", "/admin/security/commercial-signing-keys"]] },
] as const;

export function AdminNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => href === "/admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return <nav aria-label="Administration" className="admin-sidebar text-[#F5F7FA]">
    <div className="admin-sidebar-header"><Link href="/admin" className="admin-sidebar-brand">Admin console</Link><button type="button" className="admin-sidebar-toggle" aria-expanded={open} aria-controls="admin-navigation" onClick={() => setOpen(!open)}>{open ? "Close" : "Menu"}</button></div>
    <div id="admin-navigation" className={`admin-sidebar-content ${open ? "is-open" : ""}`}>
      {groups.map(group => <section className="admin-nav-group" key={group.label}><h2>{group.label}</h2><div className="admin-nav-links">{group.links.map(([label, href]) => { const active = isActive(href); return <Link aria-current={active ? "page" : undefined} className={`admin-nav-link ${active ? "is-active" : ""}`} href={href} key={href} onClick={() => setOpen(false)}>{label}</Link>; })}</div></section>)}
    </div>
  </nav>;
}
