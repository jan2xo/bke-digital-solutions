"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type ProductCard = {
  id: string;
  slug: string;
  name: string;
  summary: string;
  type: string;
  priceLabel: string;
};

type LandingContent = {
  heroEyebrow: string;
  heroHeadline: string;
  heroDescription: string;
  heroPrimaryHref: string;
  heroPrimaryLabel: string;
  heroSecondaryHref: string;
  heroSecondaryLabel: string;
  siteName: string;
  solutionsEyebrow: string;
  solutionsHeading: string;
  solutionsAccent: string;
  solutionsLinkLabel: string;
};

const lanes = [
  { code: "01", label: "Software", detail: "Installable products with licensing and version policy.", glyph: "APP" },
  { code: "02", label: "Scripts", detail: "Focused automation and reusable operational tools.", glyph: "{ }" },
  { code: "03", label: "Digital assets", detail: "Production-ready files delivered without unnecessary machinery.", glyph: "ASSET" },
];

export function LandingExperience({ content, products }: { content: LandingContent; products: ProductCard[] }) {
  const heroRef = useRef<HTMLElement>(null);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduceMotion.matches) return;
    const node = heroRef.current;
    if (!node) return;
    const onMove = (event: PointerEvent) => {
      const rect = node.getBoundingClientRect();
      setPointer({
        x: ((event.clientX - rect.left) / rect.width - 0.5) * 2,
        y: ((event.clientY - rect.top) / rect.height - 0.5) * 2,
      });
    };
    const onLeave = () => setPointer({ x: 0, y: 0 });
    node.addEventListener("pointermove", onMove);
    node.addEventListener("pointerleave", onLeave);
    return () => {
      node.removeEventListener("pointermove", onMove);
      node.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <>
      <section ref={heroRef} className="commerce-hero">
        <div className="commerce-grid" aria-hidden="true" />
        <div className="commerce-orbit commerce-orbit-one" aria-hidden="true" />
        <div className="commerce-orbit commerce-orbit-two" aria-hidden="true" />
        <div className="shell commerce-hero-layout">
          <div className="commerce-copy motion-fade-up">
            <p className="eyebrow eyebrow-yellow">{content.heroEyebrow}</p>
            <h1>{content.heroHeadline}</h1>
            <p className="commerce-lede">{content.heroDescription}</p>
            <div className="hero-actions">
              <Link className="button button-yellow" href={content.heroPrimaryHref}>{content.heroPrimaryLabel}</Link>
              <Link className="button button-outline" href={content.heroSecondaryHref}>{content.heroSecondaryLabel}</Link>
            </div>
            <div id="how-it-works" className="commerce-proof" aria-label="Marketplace capabilities">
              <span><b>01</b> Discover</span><span><b>02</b> License</span>
            </div>
          </div>

          <div className="commerce-stage" aria-label="Interactive digital solutions preview">
            <div
              className="commerce-console"
              style={{ transform: `perspective(1100px) rotateY(${pointer.x * 7}deg) rotateX(${pointer.y * -6}deg)` }}
            >
              <div className="console-top"><span>BKE / DIGITAL SOLUTIONS</span><span className="console-live">LIVE CATALOG</span></div>
              <div className="console-core">
                <div className="console-pulse" aria-hidden="true"><span>BKE</span></div>
                <p>One storefront.<br /><strong>Multiple digital formats.</strong></p>
              </div>
              <div className="console-lanes">
                {lanes.map((lane) => <div className="console-lane" key={lane.code}><b>{lane.glyph}</b><small>{lane.label}</small></div>)}
              </div>
              <div className="console-status"><span>Catalog online</span><span>Controlled delivery</span></div>
            </div>
            <div className="commerce-float commerce-float-a">SOFTWARE</div>
            <div className="commerce-float commerce-float-b">SCRIPTS</div>
            <div className="commerce-float commerce-float-c">ASSETS</div>
          </div>
        </div>
        <p className="commerce-signature">{content.siteName}</p>
      </section>

      <section className="commerce-lanes-section" id="features">
        <div className="shell">
          <div className="section-heading commerce-heading">
            <div><p className="eyebrow eyebrow-yellow">BUILT FOR WHAT YOU ACTUALLY SELL</p><h2>Not everything digital<br /><span>needs the same machinery.</span></h2></div>
            <Link href="/products" className="text-link">Browse catalog <span>→</span></Link>
          </div>
          <div className="commerce-lane-grid">
            {lanes.map((lane) => <article className="commerce-lane-card" key={lane.code}><div className="lane-glyph" style={{ marginTop: 0 }}>{lane.glyph}</div><h3>{lane.label}</h3><p>{lane.detail}</p></article>)}
          </div>
        </div>
      </section>

      <section className="solutions-section commerce-products">
        <div className="shell">
          <div className="section-heading"><div><p className="eyebrow eyebrow-yellow">{content.solutionsEyebrow}</p><h2>{content.solutionsHeading}<br /><span>{content.solutionsAccent}</span></h2></div><Link href="/products" className="text-link">{content.solutionsLinkLabel} <span>→</span></Link></div>
          <div className="solution-grid">
            {products.map((product) => <Link href={`/products/${product.slug}`} key={product.id} className="solution-card commerce-product-card" style={{ display: "flex", flexDirection: "column" }}><p className="solution-type" style={{ marginTop: 0 }}>{product.type}</p><h3>{product.name}</h3><p style={{ marginBottom: "1.5rem" }}>{product.summary}</p><strong style={{ position: "static", alignSelf: "flex-end", marginTop: "auto", paddingTop: "1rem" }}>{product.priceLabel} <span>↗</span></strong></Link>)}
          </div>
        </div>
      </section>
    </>
  );
}
