import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { LogoutButton } from "@/components/logout-button";

export async function Header() {
  const user = await currentUser();
  return <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
    <div className="shell flex min-h-18 items-center justify-between gap-6">
      <Link href="/" className="flex items-center gap-3 font-black text-[#092f47]"><span className="grid size-10 place-items-center rounded-xl bg-[#092f47] text-white">BKE</span><span>Digital Solutions</span></Link>
      <nav aria-label="Main navigation" className="flex items-center gap-5 text-sm font-semibold">
        <Link href="/products">Products</Link><Link href="/licensing">Licensing</Link>
        {user ? <><Link className="button" href={user.role === "ADMIN" ? "/admin" : "/dashboard"}>{user.role === "ADMIN" ? "Admin" : "Dashboard"}</Link><LogoutButton/></> : <><Link href="/login">Sign in</Link><Link className="button" href="/register">Get started</Link></>}
      </nav>
    </div>
  </header>;
}
