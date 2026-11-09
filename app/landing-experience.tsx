"use client";

import Link from "next/link";
import { useState, type PointerEvent } from "react";
import styles from "./landing-experience.module.css";
import { GoogleAuthButton } from "@/components/google-auth-button";

type ProductCard = {
  id: string;
  slug: string;
  name: string;
  summary: string;
  type: string;
  priceLabel: string;
  imageUrl: string | null;
};

type LandingContent = {
  heroEyebrow: string;
  heroDescription: string;
  siteName: string;
  solutionsEyebrow: string;
  solutionsHeading: string;
  solutionsAccent: string;
  solutionsLinkLabel: string;
};

const lanes = [
  {
    label: "Software",
    title: "Installable Software",
    detail: "Full applications with license validation, offline fallback, and automated release channel management.",
    status: "Licensed",
    kicker: "Software Engine",
    heading: "Enterprise grade.",
    accent: "Verified delivery.",
    icon: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18m-14-2h.01m2.99 0h.01" /></>,
  },
  {
    label: "Scripts",
    title: "Automation Scripts",
    detail: "Curated devops, bash, python, and cloud deployment recipes that execute in seconds without bloated runtimes.",
    status: "Workflows",
    kicker: "Automation Scripts",
    heading: "Cloud workflows.",
    accent: "Zero friction.",
    icon: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m7 9 3 3-3 3m6 0h4" /></>,
  },
  {
    label: "Assets",
    title: "Digital Deliverables",
    detail: "Production-ready design systems, data templates, and schemas packaged cleanly for direct implementation.",
    status: "Deliverables",
    kicker: "Digital Deliverables",
    heading: "Production assets.",
    accent: "Immediate access.",
    icon: <><path d="m12 3 9 9-9 9-9-9 9-9Z" /><path d="m12 8 4 4-4 4-4-4 4-4Z" /></>,
  },
] as const;

function LaneIcon({ lane }: { lane: (typeof lanes)[number] }) {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {lane.icon}
    </svg>
  );
}

function GoogleMark() {
  return (
    <span className={styles.googleMark} aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path fill="#4285F4" d="M21.35 12.25c0-.74-.06-1.28-.21-1.84H12v3.43h5.38a4.6 4.6 0 0 1-2 3.02v2.48h3.23c1.89-1.74 2.74-4.31 2.74-7.09z" />
        <path fill="#34A853" d="M12 21.7c2.7 0 4.96-.9 6.61-2.44l-3.23-2.48a6 6 0 0 1-8.93-3.12H3.11v2.56A9.96 9.96 0 0 0 12 21.7z" />
        <path fill="#FBBC05" d="M6.45 13.66a6.02 6.02 0 0 1 0-3.84V7.26H3.11a9.97 9.97 0 0 0 0 9l3.34-2.6z" />
        <path fill="#EA4335" d="M12 5.74c1.49 0 2.82.51 3.87 1.51l2.91-2.9A9.96 9.96 0 0 0 3.11 7.26l3.34 2.56A6 6 0 0 1 12 5.74z" />
      </svg>
    </span>
  );
}

export function LandingExperience({
  content,
  products,
  account,
}: {
  content: LandingContent;
  products: ProductCard[];
  account: "ADMIN" | "CUSTOMER" | null;
}) {
  const [selectedLane, setSelectedLane] = useState<(typeof lanes)[number] | null>(null);

  function tiltConsole(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const stage = event.currentTarget;
    const rect = stage.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    const y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    stage.style.setProperty("--tilt-x", `${-3 - y * 8}deg`);
    stage.style.setProperty("--tilt-y", `${-9 + x * 10}deg`);
  }

  function resetConsole(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.style.removeProperty("--tilt-x");
    event.currentTarget.style.removeProperty("--tilt-y");
  }

  return (
    <div className={styles.storefront}>
      <section className={styles.hero} aria-labelledby="storefront-title">
        <div className={`${styles.storefrontShell} ${styles.heroInner}`}>
          <div>
            <p className={styles.eyebrow}>{content.heroEyebrow}</p>
            <h1 id="storefront-title" className={styles.heroTitle}>
              One platform.<br />{" "}Every BKE<br />{" "}<span>solution</span>.
            </h1>
            <p className={styles.lede}>{content.heroDescription}</p>
            <div className={styles.actions}>
              {account ? (
                <Link className={styles.googleButton} href={account === "ADMIN" ? "/admin" : "/dashboard"}>
                  {account === "ADMIN" ? "Admin dashboard" : "My Software"}
                </Link>
              ) : (
                <GoogleAuthButton flow="unified" formClassName="" buttonClassName={styles.googleButton} icon={<GoogleMark />} />
              )}
              <Link className={styles.exploreLink} href="/products">Explore</Link>
            </div>
          </div>

          <div className={styles.stage} role="group" aria-label="Interactive BKE solution console" onPointerMove={tiltConsole} onPointerLeave={resetConsole}>
            <div className={styles.stageRing} aria-hidden="true" />
            <div className={`${styles.stageRing} ${styles.two}`} aria-hidden="true" />
            <div className={styles.console}>
              <div className={styles.consoleTop}>
                <span>BKE / SOLUTION CONSOLE</span>
                <span className={styles.liveStatus}><span className={styles.liveDot} />STOREFRONT</span>
              </div>
              <div className={styles.consoleCore} aria-live="polite">
                <div className={styles.pulseRingUnit} aria-hidden="true">BKE</div>
                <div>
                  <div className={styles.coreKicker}>{selectedLane?.kicker ?? "Active Ecosystem"}</div>
                  <h2>{selectedLane?.heading ?? "Unified storefront."}<br /><span>{selectedLane?.accent ?? "Multiple solutions."}</span></h2>
                </div>
              </div>
              <div className={styles.consoleLanes} role="group" aria-label="Console modes">
                {lanes.map((lane) => {
                  const active = lane === (selectedLane ?? lanes[0]);
                  return (
                    <button type="button" className={`${styles.lane}${active ? ` ${styles.active}` : ""}`} key={lane.label} aria-pressed={active} onClick={() => setSelectedLane(lane)}>
                      <span className={styles.laneIcon}><LaneIcon lane={lane} /></span>
                      <span className={styles.laneName}>{lane.label}</span>
                      <span className={styles.laneDetail}>{lane.status}</span>
                    </button>
                  );
                })}
              </div>
              <div className={styles.consoleBottom}><span>{content.siteName}</span><span>Software, scripts &amp; assets</span></div>
            </div>
            <span className={`${styles.floatLabel} ${styles.one}`} aria-hidden="true">SOFTWARE TIERS</span>
            <span className={`${styles.floatLabel} ${styles.two}`} aria-hidden="true">AUTOMATION SCRIPTS</span>
            <span className={`${styles.floatLabel} ${styles.three}`} aria-hidden="true">DIGITAL ASSETS</span>
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.alt}`} id="features" aria-labelledby="storefront-features">
        <div className={styles.storefrontShell}>
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.eyebrow}>Built for what you actually sell</p>
              <h2 id="storefront-features">Not everything digital<br /><em>needs the same machinery.</em></h2>
            </div>
            <Link href="/products" className={styles.smallLink}>Explore the catalog <span aria-hidden="true">↗</span></Link>
          </div>
          <div className={styles.cards}>
            {lanes.map((lane) => (
              <article className={styles.card} key={lane.label} tabIndex={0}>
                <div className={styles.cardIcon}><LaneIcon lane={lane} /></div>
                <h3>{lane.title}</h3>
                <p>{lane.detail}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.section} id="products" aria-labelledby="storefront-products">
        <div className={styles.storefrontShell}>
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.eyebrow}>{content.solutionsEyebrow}</p>
              <h2 id="storefront-products">{content.solutionsHeading}<br /><em>{content.solutionsAccent}</em></h2>
            </div>
            <Link className={styles.smallLink} href="/products">{content.solutionsLinkLabel} <span aria-hidden="true">↗</span></Link>
          </div>
          {products.length > 0 ? (
            <div className={styles.catalogGrid}>
              {products.map((product) => (
                <Link href={`/products/${product.slug}`} key={product.id} className={styles.productCard}>
                  {/* Product images already use the allowlisted GitHub release source in the catalog. */}
                  {product.imageUrl && <img className={styles.productImage} src={product.imageUrl} alt="" loading="lazy" />}
                  <div>
                    <span className={styles.productBadge}>{product.type}</span>
                    <h3 className={styles.productTitle}>{product.name}</h3>
                    <p className={styles.productDesc}>{product.summary}</p>
                  </div>
                  <strong className={styles.productMeta}>{product.priceLabel}<span aria-hidden="true">↗</span></strong>
                </Link>
              ))}
            </div>
          ) : (
            <div className={styles.emptyCatalogBoundary}>
              <h3>No products are listed yet</h3>
              <p>Check back when new software, scripts, and digital assets are available.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
