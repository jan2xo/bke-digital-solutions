import { redirect } from "next/navigation";
import { currentIdentitySession } from "@/apps/web/auth/session";
import { safeLocalRedirect } from "@/apps/web/security/redirect";
import { RecentAuthenticationForm } from "@/components/recent-authentication-form";

export default async function RecentAuthenticationPage({
  searchParams,
}: { searchParams: Promise<{ returnTo?: string; error?: string }> }) {
  const context = await currentIdentitySession();
  if (!context) redirect("/login");
  const { returnTo, error } = await searchParams;
  // Admins no longer need a secondary Google authentication-time challenge.
  if (context.principal.role === "ADMIN") redirect(safeLocalRedirect(returnTo || "/admin"));
  return (
    <section className="motion-fade-up mx-auto max-w-md px-4 py-16">
      <h1 className="text-4xl font-black">Confirm with Google</h1>
      <p className="my-4 text-slate-600">
        Sensitive actions require Google to confirm authentication within the last 15 minutes.
        Choosing an account or granting consent alone does not confirm recent authentication.
      </p>
      {error && <p role="alert">Google did not provide the fresh authentication proof required for this action. Authenticate with Google again, then retry. If proof remains unavailable, this action stays locked.</p>}
      <RecentAuthenticationForm returnTo={safeLocalRedirect(returnTo)} />
    </section>
  );
}
