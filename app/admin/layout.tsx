import { redirect } from "next/navigation";
import { AdminNav } from "@/components/admin-nav";
import { currentIdentitySession } from "@/v2/apps/web/auth/session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const context = await currentIdentitySession();
  if (!context) redirect("/login");
  if (context.principal.role !== "ADMIN") redirect("/dashboard");
  if (!context.administratorMfaEnabled) redirect("/security/mfa");
  if (!context.session.mfaVerifiedAt) redirect("/login");
  return <div className="admin-layout"><AdminNav/><div className="admin-content">{children}</div></div>;
}
