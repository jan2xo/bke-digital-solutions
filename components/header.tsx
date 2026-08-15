import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { LogoutButton } from "@/components/logout-button";
import { getSiteContent } from "@/lib/site-content";

export async function Header() {
  const user = await currentUser();
  const content = await getSiteContent();
  return <header className="site-header">
    <div className="shell flex min-h-20 items-center justify-between gap-6">
      <Link href="/" className="brand-lockup"><span className="brand-mark" aria-hidden="true">BKE</span><span>{content.siteName}</span></Link>
      <nav aria-label="Main navigation" className="site-nav">
        <Link href="/products">Products</Link><Link href="/licensing">Licensing</Link><Link href="/products#pricing">Pricing</Link><Link href="/licensing">How it works</Link>
        {user ? <><Link className="button button-yellow" href={user.role === "ADMIN" ? "/admin" : "/dashboard"}>{user.role === "ADMIN" ? "Admin" : "Dashboard"}</Link><LogoutButton/></> : <><Link href="/login">Sign in</Link><Link className="button button-yellow" href="/register">Get started</Link></>}
      </nav>
    </div>
  </header>;
}
