import Link from "next/link";
import { currentUser } from "@/apps/web/auth/session";
import { LogoutButton } from "@/components/logout-button";
import { getSiteContent } from "@/apps/web/site-content";

export async function Header() {
  const user = await currentUser();
  const content = await getSiteContent();
  const accountLinks = user ? (
    <>
      <Link href={user.role === "ADMIN" ? "/admin/notifications" : "/dashboard/notifications"}>Notifications</Link>
      <Link className="button button-yellow" href={user.role === "ADMIN" ? "/admin" : "/dashboard"}>{user.role === "ADMIN" ? "Admin" : "Dashboard"}</Link>
      <LogoutButton />
    </>
  ) : (
    <>
      <Link href="/login">Sign in</Link>
      <Link className="button button-yellow" href="/register">Get started</Link>
    </>
  );
  const publicLinks = (
    <>
      <Link href="/products">Products</Link>
      <Link href="/products#pricing">Pricing</Link>
      <Link href="/licensing">How it works</Link>
      <Link href="/bke">Download BKE</Link>
    </>
  );

  return (
    <header className="site-header">
      <div className="shell site-header-inner">
        <Link href="/" className="brand-lockup"><span className="brand-mark" aria-hidden="true">BKE</span><span>{content.siteName}</span></Link>
        <nav aria-label="Main navigation" className="site-nav">
          {publicLinks}
          {accountLinks}
        </nav>
        <details key={user?.id ?? "guest"} className="mobile-menu">
          <summary aria-label="Open navigation menu">Menu</summary>
          <nav aria-label="Mobile navigation" className="mobile-menu-panel">
            <a href="/products">Products</a>
            <a href="/products#pricing">Pricing</a>
            <a href="/licensing">How it works</a>
            <a href="/bke">Download BKE</a>
            {user ? (
              <>
                <a href={user.role === "ADMIN" ? "/admin/notifications" : "/dashboard/notifications"}>Notifications</a>
                <a className="button button-yellow mobile-account-action" href={user.role === "ADMIN" ? "/admin" : "/dashboard"}>{user.role === "ADMIN" ? "Admin" : "Dashboard"}</a>
                <LogoutButton />
              </>
            ) : (
              <>
                <a href="/login">Sign in</a>
                <a className="button button-yellow mobile-account-action" href="/register">Get started</a>
              </>
            )}
          </nav>
        </details>
      </div>
    </header>
  );
}
