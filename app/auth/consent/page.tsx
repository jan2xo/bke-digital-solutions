import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { registrationLegalDocuments } from "@/apps/web/legal/service";
import { GOOGLE_ENROLLMENT_COOKIE, readPendingGoogleEnrollment } from "@/apps/web/auth/google-enrollment";
import { GoogleEnrollmentConsent } from "@/components/google-enrollment-consent";

export const metadata = { title: "Continue with BKE" };

export default async function CustomerConsentPage() {
  const token = (await cookies()).get(GOOGLE_ENROLLMENT_COOKIE)?.value;
  if (!token) redirect("/login");
  try {
    await readPendingGoogleEnrollment(token);
  } catch {
    redirect("/login?error=GOOGLE_SIGN_IN_FAILED");
  }
  const documents = await registrationLegalDocuments();
  const available = documents.length === 2 && documents.every(
    (doc) => doc.currentPublishedVersionId && doc.currentPublishedVersion?.status === "PUBLISHED",
  );
  return (
    <section className="motion-fade-up mx-auto max-w-lg px-4 py-16">
      <p className="text-sm font-bold text-[#ffd15a]">BKE DIGITAL SOLUTIONS</p>
      <h1 className="mt-3 text-4xl font-black">One last step.</h1>
      <p className="mt-4 mb-8 text-[#a8b5c4]">
        Google has verified your identity. Review and accept the current legal
        documents before we create your BKE customer account.
      </p>
      {available ? (
        <GoogleEnrollmentConsent documents={documents.map((document) => ({
          title: document.title,
          slug: document.slug,
          versionId: document.currentPublishedVersionId!,
        }))} />
      ) : (
        <div role="alert" className="card p-6">
          <h2 className="font-black">Account creation is temporarily unavailable.</h2>
          <p className="mt-2 text-[#a8b5c4]">The required legal documents are not available.</p>
        </div>
      )}
    </section>
  );
}
