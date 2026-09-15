import { redirect } from "next/navigation";
import { currentIdentitySession } from "@/v2/apps/web/auth/session";
import { MfaEnrollmentForm } from "@/components/mfa-enrollment-form";
export default async function MfaEnrollmentPage(){const context=await currentIdentitySession().catch(()=>null);if(!context||context.principal.role!=="ADMIN")redirect("/login");if(context.administratorMfaEnabled)redirect("/admin");return <section className="motion-fade-up mx-auto max-w-xl px-4 py-16"><h1 className="text-4xl font-black">Secure your administrator account</h1><p className="my-4 text-slate-600">BKE Digital Solutions requires a one-time email code after the administrator password.</p><MfaEnrollmentForm/></section>}
