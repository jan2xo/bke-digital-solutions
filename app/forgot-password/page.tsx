import Link from "next/link";

export default function ForgotPasswordPage() {
  return (
    <section className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-3xl font-black">Password sign-in is retired</h1>
      <p className="mt-4 text-slate-600">Use the Google account already bound to your BKE account.</p>
      <Link className="button primary mt-6 inline-block" href="/login">Continue with Google</Link>
    </section>
  );
}
