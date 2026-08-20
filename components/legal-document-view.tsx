import Link from "next/link";
import { MotionReveal } from "@/components/motion-reveal";

export function LegalDocumentView({ title, versionNumber, effectiveAt, html, slug, historical = false }: { title: string; versionNumber: number; effectiveAt: Date | null; html: string; slug: string; historical?: boolean }) {
  return <article className="mx-auto max-w-3xl px-4 py-14">
    <MotionReveal><p className="font-bold text-[#3D75A7]">{historical ? "Historical legal version" : "Legal & Compliance"}</p></MotionReveal>
    <MotionReveal delay={1}><h1 className="mt-2 text-4xl font-black">{title}</h1><p className="mt-3 text-sm text-slate-600">Version {versionNumber}{effectiveAt ? ` · Effective ${effectiveAt.toLocaleDateString("en-PH")}` : ""}</p></MotionReveal>
    {historical && <MotionReveal delay={2}><p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">This is an older version. <Link className="font-bold underline" href={`/legal/${slug}`}>View the current version.</Link></p></MotionReveal>}
    <MotionReveal delay={historical ? 3 : 2}><div className="legal-content card mt-8 p-7" dangerouslySetInnerHTML={{ __html: html }} /></MotionReveal>
  </article>;
}
