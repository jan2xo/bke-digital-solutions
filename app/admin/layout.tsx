import { redirect } from "next/navigation";
import { AdminNav } from "@/components/admin-nav";
import { currentSession } from "@/lib/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/dashboard");
  if (!session.user.administratorMfa?.enabledAt) redirect("/security/mfa");
  if (!session.mfaVerifiedAt) redirect("/login");
  return <><AdminNav/>{children}</>;
}
