"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const links = [["Overview", "/admin"], ["Observability", "/admin/observability"], ["Products", "/admin/products"], ["Offers", "/admin/offers"], ["Releases", "/admin/releases"], ["Supply Chain", "/admin/supply-chain"], ["Artifacts", "/admin/artifacts"], ["Customers", "/admin/customers"], ["Subscriptions", "/admin/subscriptions"], ["Trials", "/admin/trials"], ["Licenses", "/admin/licenses"], ["Devices", "/admin/devices"], ["Orders", "/admin/orders"], ["Payments", "/admin/payments"], ["Invoices", "/admin/invoices"], ["Scheduler", "/admin/scheduler"], ["Backups", "/admin/backups"], ["Legal & Compliance", "/admin/legal"], ["Compliance Review", "/admin/compliance"], ["Providers", "/admin/providers"], ["Audit", "/admin/audit"], ["Security", "/admin/security"], ["Signing Keys", "/admin/security/commercial-signing-keys"]] as const;

export function AdminNav() {
  const pathname = usePathname();
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  function updateEdges() {
    const node = scroller.current;
    if (!node) return;
    setEdges({ left: node.scrollLeft > 2, right: node.scrollLeft + node.clientWidth < node.scrollWidth - 2 });
  }

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    node.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    updateEdges();
    const observer = new ResizeObserver(updateEdges);
    observer.observe(node);
    return () => observer.disconnect();
  }, [pathname]);

  function scroll(direction: number) { scroller.current?.scrollBy({ left: direction * 320, behavior: "smooth" }); }

  return <nav aria-label="Administration" className="relative border-b border-[#2D5579] bg-[#10161E] text-[#F5F7FA]">
    {edges.left && <button type="button" aria-label="Scroll administration navigation left" className="admin-nav-control left-0" onClick={() => scroll(-1)}>‹</button>}
    <div ref={scroller} onScroll={updateEdges} className="admin-nav-scroll shell flex gap-1 overflow-x-auto py-2">
      {links.map(([label, href]) => {
        const active = href === "/admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
        return <Link aria-current={active ? "page" : undefined} className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-bold hover:bg-[#213A53] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${active ? "bg-[#3D75A7] text-white" : ""}`} href={href} key={href}>{label}</Link>;
      })}
    </div>
    {edges.right && <button type="button" aria-label="Scroll administration navigation right" className="admin-nav-control right-0" onClick={() => scroll(1)}>›</button>}
  </nav>;
}
