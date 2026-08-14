import { redirect } from "next/navigation";
import { currentSession } from "@/lib/auth";
import { RecentAuthenticationForm } from "@/components/recent-authentication-form";

export default async function RecentAuthenticationPage() {
  const session = await currentSession();
  if (!session) redirect("/login");
  return <section className="motion-fade-up mx-auto max-w-md px-4 py-16"><h1 className="text-4xl font-black">Confirm your identity</h1><p className="my-4 text-slate-600">This sensitive action requires a fresh credential check. Confirmation remains valid for 15 minutes.</p><RecentAuthenticationForm admin={session.user.role === "ADMIN"}/></section>;
}
