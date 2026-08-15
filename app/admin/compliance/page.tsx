import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { ComplianceAdminControls } from "@/components/compliance-admin-controls";

export default async function CompliancePage() {
  await requireAdmin();
  const requirements = await db.complianceRequirement.findMany({ include: { evidence: { orderBy: { createdAt: "desc" }, take: 5 } }, orderBy: [{ category: "asc" }, { title: "asc" }] });
  const counts = requirements.reduce<Record<string, number>>((a, r) => { a[r.status] = (a[r.status] ?? 0) + 1; return a; }, {});
  return <main className="shell py-10"><h1 className="text-4xl font-black">Compliance readiness</h1><p className="mt-2 text-slate-600">Evidence and status tracking only. No entry on this page represents legal, tax, privacy, or regulatory approval.</p><div className="my-6 flex flex-wrap gap-3">{Object.entries(counts).map(([status, count]) => <span key={status} className="rounded-full border px-3 py-2 text-sm font-bold">{status}: {count}</span>)}</div><div className="space-y-4">{requirements.map((r) => <section key={r.id} className="card p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase text-slate-500">{r.category}</p><h2 className="text-xl font-black">{r.title}</h2><p className="mt-1 text-slate-600">{r.description}</p></div><span className="rounded-full border border-[#3d75a7] bg-[#213a53] px-3 py-1 text-xs font-bold">{r.status}</span></div>{r.evidence.length > 0 && <ul className="mt-4 space-y-1 text-sm text-slate-600">{r.evidence.map((e) => <li key={e.id}>Evidence: {e.summary} ({e.kind})</li>)}</ul>}<ComplianceAdminControls requirementId={r.id} currentStatus={r.status} /></section>)}</div></main>;
}
