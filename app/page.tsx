import Link from "next/link";
import { db } from "@/lib/db";
import { resolvePurchasePlan } from "@/lib/pricing";

export default async function Home() {
  const products = await db.product.findMany({
    where: { active: true, archivedAt: null },
    include: {
      prices: { where: { active: true }, orderBy: { amountMinor: "asc" }, take: 1 },
      editions: {
        where: { active: true },
        include: { purchasePlans: { where: { active: true }, include: { monthlySource: true } } },
      },
    },
    orderBy: [{ featured: "desc" }, { publishedAt: "desc" }, { createdAt: "desc" }],
    take: 3,
  });
  return <>
    <section className="overflow-hidden bg-[#14202B] py-24 text-white"><div className="shell grid gap-12 md:grid-cols-[1.2fr_.8fr] md:items-center"><div><p className="mb-4 font-bold uppercase tracking-[.22em] text-[#7FA9CF]">Built for dependable work</p><h1 className="max-w-3xl text-5xl font-black leading-tight md:text-7xl">Software that moves your organization forward.</h1><p className="mt-6 max-w-2xl text-lg leading-8 text-[#A8B5C4]">Secure products, flexible licenses, and practical SaaS solutions for individuals, businesses, and institutions.</p><div className="mt-9 flex gap-3"><Link className="button bg-[#3D75A7]! text-[#F5F7FA]! hover:bg-[#2D5579]!" href="/products">Explore products</Link><Link className="button secondary" href="/licensing">How licensing works</Link></div></div><div className="hero-portal-card rotate-2 p-8 text-[#F5F7FA]"><div className="flex items-center justify-between"><p className="text-sm font-bold uppercase tracking-widest text-[#7FA9CF]">One secure portal</p><span className="h-2.5 w-2.5 rounded-full bg-[#3D75A7] shadow-[0_0_18px_#3D75A7]"/></div><div className="mt-8 grid gap-4">{["Manage users and devices", "Review orders and invoices", "Renew licenses on your terms"].map((x, i)=><div key={x} className="hero-portal-row flex items-center p-5"><span className="mr-4 font-black text-[#7FA9CF]">0{i+1}</span><span className="font-semibold">{x}</span></div>)}</div></div></div></section>
    <section className="shell py-20"><div className="flex items-end justify-between"><div><p className="font-bold text-[#0b7197]">Our solutions</p><h2 className="mt-2 text-4xl font-black">Choose what fits today.</h2></div><Link href="/products" className="font-bold text-[#0b7197]">View catalog →</Link></div><div className="mt-10 grid gap-6 md:grid-cols-3">{products.map(product=>{const plans=product.editions.flatMap(edition=>edition.purchasePlans);const starting=plans.map(plan=>resolvePurchasePlan(plan).amountMinor).sort((a,b)=>a-b)[0]??product.prices[0]?.amountMinor;return <Link href={`/products/${product.slug}`} key={product.id} className="card p-7 transition hover:-translate-y-1"><p className="text-xs font-bold uppercase tracking-widest text-[#0b7197]">{product.type}</p><h3 className="mt-3 text-2xl font-black">{product.name}</h3><p className="mt-3 leading-7 text-slate-600">{product.summary}</p><p className="mt-7 font-bold">{starting===undefined?"Contact us":`From ${money(starting)}`}</p></Link>})}</div></section>
  </>;
}

function money(minor: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(minor / 100);
}
