import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { pendingReacceptance } from "@/lib/legal/service";
import { LegalReacceptanceForm } from "@/components/legal-reacceptance-form";
const safeReturn = (value?: string) => value?.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
export default async function LegalAcceptancePage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) { const user = await requireUser().catch(() => redirect("/login")); const documents = await pendingReacceptance(user.id); const returnTo = safeReturn((await searchParams).returnTo); if (!documents.length) redirect(returnTo); return <main className="mx-auto max-w-2xl px-4 py-14"><p className="font-bold text-[#3D75A7]">Updated legal documents</p><h1 className="mt-2 text-4xl font-black">Review before continuing</h1><p className="mt-3 text-slate-600">Your session remains active. Review and accept each newly published document to continue.</p><LegalReacceptanceForm returnTo={returnTo} documents={documents.map(item => ({ versionId: item.currentPublishedVersionId!, title: item.title, slug: item.slug }))}/></main>; }

