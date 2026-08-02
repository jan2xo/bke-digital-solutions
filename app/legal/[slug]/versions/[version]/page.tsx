import { notFound } from "next/navigation";
import { LegalDocumentView } from "@/components/legal-document-view";
import { db } from "@/lib/db";
import { renderLegalMarkdown } from "@/lib/legal/render";
export default async function HistoricalLegalPage({ params }: { params: Promise<{ slug: string; version: string }> }) { const { slug, version } = await params; const number = Number(version); if (!Number.isInteger(number) || number < 1) notFound(); const document = await db.legalDocument.findUnique({ where: { slug }, include: { versions: { where: { versionNumber: number, status: { in: ["PUBLISHED", "ARCHIVED"] } }, take: 1 } } }); const item = document?.versions[0]; if (!document || !item) notFound(); return <LegalDocumentView title={document.title} slug={document.slug} versionNumber={item.versionNumber} effectiveAt={item.effectiveAt} html={renderLegalMarkdown(item.markdownContent)} historical={document.currentPublishedVersionId !== item.id}/>; }

