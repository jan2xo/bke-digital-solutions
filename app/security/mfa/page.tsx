import { redirect } from "next/navigation";
import { requireAdminEnrollmentSession } from "@/lib/auth";
import { MfaEnrollmentForm } from "@/components/mfa-enrollment-form";
export default async function MfaEnrollmentPage(){const session=await requireAdminEnrollmentSession().catch(()=>redirect("/login"));if(session.user.administratorMfa?.enabledAt)redirect("/admin");return <section className="motion-fade-up mx-auto max-w-xl px-4 py-16"><h1 className="text-4xl font-black">Secure your administrator account</h1><p className="my-4 text-slate-600">BKE Digital Solutions requires a one-time email code after the administrator password.</p><MfaEnrollmentForm/></section>}
