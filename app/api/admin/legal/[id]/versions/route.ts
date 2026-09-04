import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/v2/apps/web/http/api-error";
import { legalContentHash, renderLegalMarkdown } from "@/lib/legal/render";
import { assertSameOrigin } from "@/v2/apps/web/http/request";

const schema = z.object({ markdownContent: z.string().min(1).max(200_000).optional(), changeSummary: z.string().trim().min(2).max(500), requiresReacceptance: z.boolean().default(false), duplicateVersionId: z.string().cuid().optional() }).strict();
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request); const admin = await requireAdmin(); const { id } = await params; const input = schema.parse(await request.json());
    const version = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "LegalDocument" WHERE id = ${id} FOR UPDATE`;
      const document = await tx.legalDocument.findUniqueOrThrow({ where: { id }, include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } } });
      const duplicate = input.duplicateVersionId ? await tx.legalDocumentVersion.findFirstOrThrow({ where: { id: input.duplicateVersionId, documentId: id } }) : null;
      const markdownContent = input.markdownContent ?? duplicate?.markdownContent;
      if (!markdownContent) throw new Error("LEGAL_CONTENT_REQUIRED");
      const renderedHtml = renderLegalMarkdown(markdownContent);
      const created = await tx.legalDocumentVersion.create({ data: { documentId: id, versionNumber: (document.versions[0]?.versionNumber ?? 0) + 1, markdownContent, renderedHtml, contentHash: legalContentHash(renderedHtml), changeSummary: input.changeSummary, requiresReacceptance: input.requiresReacceptance, authorId: admin.id } });
      await tx.auditLog.create({ data: { actorId: admin.id, action: input.duplicateVersionId ? "LEGAL_VERSION_DUPLICATED" : "LEGAL_DRAFT_CREATED", targetType: "LegalDocumentVersion", targetId: created.id, metadata: { documentId: id, versionNumber: created.versionNumber } } });
      return created;
    }, { isolationLevel: "Serializable" });
    return NextResponse.json(version, { status: 201 });
  } catch (error) { return apiError(error); }
}

