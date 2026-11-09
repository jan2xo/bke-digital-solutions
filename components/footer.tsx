import Link from "next/link";
import { getSiteContent } from "@/apps/web/site-content";
import { OutsideHomepage } from "@/components/outside-homepage";

export async function Footer() {
  const content = await getSiteContent();

  return (
    <footer className="site-footer">
      <div className="shell flex flex-col gap-4 text-sm text-slate-400 md:flex-row md:items-center md:justify-between">
        <div>
          <p>© {new Date().getFullYear()} BKES Information Technology Solutions</p>
          <p>{content.footerText}</p>
        </div>
        <OutsideHomepage><a href={`mailto:${content.supportEmail}`}>{content.supportEmail}</a></OutsideHomepage>
        <nav aria-label="Legal" className="flex flex-wrap gap-5">
          <Link href="/legal/terms">Terms</Link>
          <Link href="/legal/privacy">Privacy</Link>
          <Link href="/legal/eula">EULA</Link>
          <Link href="/legal/refund">Refunds</Link>
          <Link href="/legal/cookies">Cookies</Link>
        </nav>
      </div>
    </footer>
  );
}
