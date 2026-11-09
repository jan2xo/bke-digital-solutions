import { GoogleAuthButton } from "@/components/google-auth-button";
import { safeLocalRedirect } from "@/apps/web/security/redirect";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; error?: string }>;
}) {
  const { returnTo, error } = await searchParams;
  const destination = safeLocalRedirect(returnTo);
  return (
    <section className="motion-fade-up mx-auto max-w-md px-4 py-16">
      <h1 className="mb-3 text-4xl font-black">Continue with BKE</h1>
      <p className="mb-8 text-[#a8b5c4]">
        One Google account entry for new and returning customers.
        New customers review the required legal documents after Google verification.
      </p>
      {error && <p role="alert" className="mb-4 text-sm text-red-400">
        {error === "CONTACT_EMAIL_NOT_AUTHORITATIVE"
          ? "Use a verified Gmail or Google Workspace account to continue."
          : "Google sign-in could not be completed. Try again."}
      </p>}
      <GoogleAuthButton flow="unified" returnTo={destination} />
    </section>
  );
}
