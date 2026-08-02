import { notFound } from "next/navigation";
import { LegalDocumentView } from "@/components/legal-document-view";
import { db } from "@/lib/db";
import { renderLegalMarkdown } from "@/lib/legal/render";
export default async function CurrentLegalPage({ params }: { params: Promise<{ slug: string }> }) { const { slug } = await params; const document = await db.legalDocument.findFirst({ where: { slug, status: "ACTIVE", currentPublishedVersion: { is: { status: "PUBLISHED" } } }, include: { currentPublishedVersion: true } }); if (!document?.currentPublishedVersion) notFound(); return <LegalDocumentView title={document.title} slug={document.slug} versionNumber={document.currentPublishedVersion.versionNumber} effectiveAt={document.currentPublishedVersion.effectiveAt} html={renderLegalMarkdown(document.currentPublishedVersion.markdownContent)}/>; }

