import Link from "next/link";
import { getSiteContent } from "@/apps/web/site-content";
import { publishedLegalDocuments } from "@/apps/web/legal/service";
import { OutsideHomepage } from "@/components/outside-homepage";

const legalFooterItems = [
  { type: "TERMS_OF_SERVICE", label: "Terms" },
  { type: "PRIVACY_POLICY", label: "Privacy" },
  { type: "SOFTWARE_LICENSE_AGREEMENT", label: "EULA" },
  { type: "REFUND_POLICY", label: "Refunds" },
  { type: "COOKIE_POLICY", label: "Cookies" },
] as const;

export async function Footer() {
  const [content, legalDocuments] = await Promise.all([
    getSiteContent(),
    publishedLegalDocuments(legalFooterItems.map((item) => item.type)),
  ]);
  // The database owns the public slug. Never synthesize a route from its legal type.
  const slugsByType = new Map(
    legalDocuments
      .filter((document) => document.currentPublishedVersion?.status === "PUBLISHED")
      .map((document) => [document.documentType, document.slug]),
  );

  return (
    <footer className="site-footer">
      <div className="shell flex flex-col gap-4 text-sm text-slate-400 md:flex-row md:items-center md:justify-between">
        <div>
          <p>© {new Date().getFullYear()} BKES Information Technology Solutions</p>
          <p>{content.footerText}</p>
        </div>
        <OutsideHomepage><a href={`mailto:${content.supportEmail}`}>{content.supportEmail}</a></OutsideHomepage>
        <nav aria-label="Legal" className="flex flex-wrap gap-5">
          {legalFooterItems.map(({ type, label }) => {
            const slug = slugsByType.get(type);
            return slug ? <Link href={`/legal/${slug}`} key={type}>{label}</Link> : null;
          })}
        </nav>
      </div>
    </footer>
  );
}
