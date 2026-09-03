import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/v2/apps/web/http/api-error";
import { assertSameOrigin } from "@/v2/apps/web/http/request";

const schema = z.object({ title: z.string().trim().min(2).max(160).optional(), status: z.enum(["ACTIVE", "ARCHIVED"]).optional() }).strict();
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request); const admin = await requireAdmin(); const { id } = await params; const input = schema.parse(await request.json());
    const document = await db.$transaction(async (tx) => {
      const updated = await tx.legalDocument.update({ where: { id }, data: input });
      await tx.auditLog.create({ data: { actorId: admin.id, action: input.status === "ARCHIVED" ? "LEGAL_DOCUMENT_ARCHIVED" : input.status === "ACTIVE" ? "LEGAL_DOCUMENT_RESTORED" : "LEGAL_DOCUMENT_UPDATED", targetType: "LegalDocument", targetId: id, metadata: { fields: Object.keys(input) } } });
      return updated;
    });
    return NextResponse.json(document);
  } catch (error) { return apiError(error); }
}

