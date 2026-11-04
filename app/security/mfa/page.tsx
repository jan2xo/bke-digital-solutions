import { redirect } from "next/navigation";
import { currentIdentitySession } from "@/apps/web/auth/session";
import { MfaEnrollmentForm } from "@/components/mfa-enrollment-form";
export default async function MfaEnrollmentPage(){const context=await currentIdentitySession().catch(()=>null);if(!context||context.principal.role!=="ADMIN")redirect("/login");if(context.mfaEnabled)redirect("/admin");return <section className="motion-fade-up mx-auto max-w-xl px-4 py-16"><h1 className="text-4xl font-black">Secure your administrator account</h1><p className="my-4 text-slate-600">BKE Digital Solutions requires application email verification after Google sign-in.</p><MfaEnrollmentForm/></section>}
