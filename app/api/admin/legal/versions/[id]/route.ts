import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireRecentAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/v2/apps/web/http/api-error";
import { legalContentHash, renderLegalMarkdown } from "@/lib/legal/render";
import { assertSameOrigin } from "@/v2/apps/web/http/request";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("EDIT"), markdownContent: z.string().min(1).max(200_000), changeSummary: z.string().trim().min(2).max(500), requiresReacceptance: z.boolean() }),
  z.object({ action: z.literal("PUBLISH"), effectiveAt: z.iso.datetime().optional() }),
  z.object({ action: z.literal("ARCHIVE") }),
  z.object({ action: z.literal("RESTORE") }),
]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request); const input = schema.parse(await request.json()); const admin = input.action === "PUBLISH" ? await requireRecentAdmin() : await requireAdmin(); const { id } = await params;
    const version = await db.$transaction(async (tx) => {
      const current = await tx.legalDocumentVersion.findUniqueOrThrow({ where: { id }, include: { document: true } });
      if (input.action === "EDIT") {
        if (current.status !== "DRAFT") throw new Error("LEGAL_VERSION_IMMUTABLE");
        const renderedHtml = renderLegalMarkdown(input.markdownContent);
        const updated = await tx.legalDocumentVersion.update({ where: { id }, data: { markdownContent: input.markdownContent, renderedHtml, contentHash: legalContentHash(renderedHtml), changeSummary: input.changeSummary, requiresReacceptance: input.requiresReacceptance } });
        await tx.auditLog.create({ data: { actorId: admin.id, action: "LEGAL_DRAFT_UPDATED", targetType: "LegalDocumentVersion", targetId: id, metadata: { documentId: current.documentId } } }); return updated;
      }
      if (input.action === "PUBLISH") {
        if (current.status !== "DRAFT") throw new Error("LEGAL_VERSION_IMMUTABLE");
        const now = new Date();
        if (current.document.currentPublishedVersionId) await tx.legalDocumentVersion.update({ where: { id: current.document.currentPublishedVersionId }, data: { status: "ARCHIVED", archivedAt: now } });
        const renderedHtml = current.renderedHtml ?? renderLegalMarkdown(current.markdownContent);
        const updated = await tx.legalDocumentVersion.update({ where: { id }, data: { status: "PUBLISHED", renderedHtml, contentHash: legalContentHash(renderedHtml), publishedAt: now, effectiveAt: input.effectiveAt ? new Date(input.effectiveAt) : now } });
        await tx.legalDocument.update({ where: { id: current.documentId }, data: { currentPublishedVersionId: id, status: "ACTIVE" } });
        await tx.auditLog.create({ data: { actorId: admin.id, action: "LEGAL_VERSION_PUBLISHED", targetType: "LegalDocumentVersion", targetId: id, metadata: { documentId: current.documentId, versionNumber: current.versionNumber, requiresReacceptance: current.requiresReacceptance } } }); return updated;
      }
      if (input.action === "ARCHIVE") {
        if (current.status !== "PUBLISHED") throw new Error("INVALID_STATE");
        await tx.legalDocument.updateMany({ where: { id: current.documentId, currentPublishedVersionId: id }, data: { currentPublishedVersionId: null } });
        const updated = await tx.legalDocumentVersion.update({ where: { id }, data: { status: "ARCHIVED", archivedAt: new Date() } });
        await tx.auditLog.create({ data: { actorId: admin.id, action: "LEGAL_VERSION_ARCHIVED", targetType: "LegalDocumentVersion", targetId: id, metadata: { documentId: current.documentId } } }); return updated;
      }
      if (current.status !== "ARCHIVED") throw new Error("INVALID_STATE");
      if (!current.publishedAt) throw new Error("LEGAL_VERSION_NOT_PUBLISHED");
      const previous = current.document.currentPublishedVersionId;
      if (previous && previous !== id) await tx.legalDocumentVersion.update({ where: { id: previous }, data: { status: "ARCHIVED", archivedAt: new Date() } });
      const updated = await tx.legalDocumentVersion.update({ where: { id }, data: { status: "PUBLISHED", archivedAt: null } });
      await tx.legalDocument.update({ where: { id: current.documentId }, data: { currentPublishedVersionId: id, status: "ACTIVE" } });
      await tx.auditLog.create({ data: { actorId: admin.id, action: "LEGAL_VERSION_RESTORED", targetType: "LegalDocumentVersion", targetId: id, metadata: { documentId: current.documentId, replacedVersionId: previous } } }); return updated;
    }, { isolationLevel: "Serializable" });
    return NextResponse.json(version);
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request); const admin = await requireRecentAdmin(); const { id } = await params;
    await db.$transaction(async (tx) => { const version = await tx.legalDocumentVersion.findUniqueOrThrow({ where: { id } }); if (version.status !== "DRAFT") throw new Error("LEGAL_VERSION_IMMUTABLE"); await tx.legalDocumentVersion.delete({ where: { id } }); await tx.auditLog.create({ data: { actorId: admin.id, action: "LEGAL_DRAFT_DELETED", targetType: "LegalDocumentVersion", targetId: id, metadata: { documentId: version.documentId, versionNumber: version.versionNumber } } }); });
    return new NextResponse(null, { status: 204 });
  } catch (error) { return apiError(error); }
}

