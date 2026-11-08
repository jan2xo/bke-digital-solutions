import Link from "next/link";
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
      <h1 className="mb-8 text-4xl font-black">Welcome back</h1>
      {error && <p role="alert" className="mb-4 text-sm text-red-700">{error === "CONTACT_EMAIL_NOT_AUTHORITATIVE" ? "Use a verified Gmail or Google Workspace account to continue." : "Google sign-in could not be completed. Try again."}</p>}
      <GoogleAuthButton flow="login" returnTo={destination} />
      <p className="mt-5 text-center text-sm">
        New here? <Link className="font-bold text-[#8cc8f5]" href="/register">Create an account</Link>
      </p>
    </section>
  );
}
