import Link from "next/link";
import { db } from "@/lib/db";
import { resolvePurchasePlan } from "@/lib/pricing";
import { getSiteContent } from "@/lib/site-content";

export default async function Home() {
  const content = await getSiteContent();
  const products = await db.product.findMany({ where: { active: true, archivedAt: null }, include: { prices: { where: { active: true }, orderBy: { amountMinor: "asc" }, take: 1 }, editions: { where: { active: true }, include: { purchasePlans: { where: { active: true }, include: { monthlySource: true } } } } }, orderBy: [{ featured: "desc" }, { publishedAt: "desc" }, { createdAt: "desc" }], take: 3 });
  return <>
    <section className="motion-fade-up hero-section"><div className="hero-glow"/><div className="shell hero-inner"><p className="eyebrow">{content.heroEyebrow}</p><h1>{content.heroHeadline}</h1><p className="hero-copy">{content.heroDescription}</p><div className="hero-actions"><Link className="button button-yellow" href={content.heroPrimaryHref}>{content.heroPrimaryLabel}</Link><Link className="button button-outline" href={content.heroSecondaryHref}>{content.heroSecondaryLabel}</Link></div><p className="hero-tagline">{content.siteName}</p></div></section>
    <section className="solutions-section" id="features"><div className="shell"><div className="section-heading"><div><p className="eyebrow eyebrow-yellow">{content.solutionsEyebrow}</p><h2>{content.solutionsHeading}<br/><span>{content.solutionsAccent}</span></h2></div><Link href="/products" className="text-link">{content.solutionsLinkLabel} <span>→</span></Link></div><div className="solution-grid">{products.map(product=>{const plans=product.editions.flatMap(edition=>edition.purchasePlans);const starting=plans.map(plan=>resolvePurchasePlan(plan).amountMinor).sort((a,b)=>a-b)[0]??product.prices[0]?.amountMinor;return <Link href={`/products/${product.slug}`} key={product.id} className="solution-card"><span className="solution-number">0{products.indexOf(product)+1}</span><p className="solution-type">{product.type}</p><h3>{product.name}</h3><p>{product.summary}</p><strong>{starting===undefined?"Explore solution":`From ${money(starting)}`} <span>↗</span></strong></Link>})}</div></div></section>
  </>;
}
function money(minor: number) { return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(minor / 100); }
