import Link from "next/link";
import { currentUser } from "@/apps/web/auth/session";
import { LogoutButton } from "@/components/logout-button";
import { getSiteContent } from "@/apps/web/site-content";
import { MobileNavigation } from "@/components/mobile-navigation";
import { OutsideHomepage } from "@/components/outside-homepage";
import { GoogleAuthButton } from "@/components/google-auth-button";

export async function Header() {
  const user = await currentUser();
  const content = await getSiteContent();
  const accountLinks = user ? (
    <>
      <Link prefetch={false} href={user.role === "ADMIN" ? "/admin/notifications" : "/dashboard/notifications"}>Notifications</Link>
      <Link prefetch={false} className="button button-yellow" href={user.role === "ADMIN" ? "/admin" : "/dashboard"}>{user.role === "ADMIN" ? "Admin" : "Dashboard"}</Link>
      <LogoutButton />
    </>
  ) : (
    <GoogleAuthButton flow="unified" formClassName="" buttonClassName="button button-yellow" />
  );
  const publicLinks = (
    <>
      <Link prefetch={false} href="/products">Products</Link>
      <Link prefetch={false} href="/licensing">How it works</Link>
      <Link prefetch={false} href="/bke">Download BKE</Link>
    </>
  );

  const header = (
    <header className="site-header">
      <div className="shell site-header-inner">
        <Link prefetch={false} href="/" className="brand-lockup"><span className="brand-mark" aria-hidden="true">BKE</span><span>{content.siteName}</span></Link>
        <nav aria-label="Main navigation" className="site-nav">
          {publicLinks}
          {accountLinks}
        </nav>
        <MobileNavigation key={user?.id ?? "guest"}>
          {publicLinks}
          {accountLinks}
        </MobileNavigation>
      </div>
    </header>
  );

  return user ? header : <OutsideHomepage>{header}</OutsideHomepage>;
}
