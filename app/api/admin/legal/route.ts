import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";
import { LEGAL_DOCUMENT_TYPES } from "@/lib/legal/constants";
import { assertSameOrigin } from "@/lib/security/request";

const createSchema = z.object({ title: z.string().trim().min(2).max(160), slug: z.string().regex(/^[a-z0-9-]+$/).max(100), documentType: z.enum(LEGAL_DOCUMENT_TYPES).or(z.string().regex(/^[A-Z][A-Z0-9_]{2,80}$/)) }).strict();

export async function GET() {
  try {
    await requireAdmin();
    const documents = await db.legalDocument.findMany({ include: { currentPublishedVersion: true, versions: { orderBy: { versionNumber: "desc" }, include: { author: { select: { name: true, email: true } }, _count: { select: { acceptances: true } }, acceptances: { orderBy: { acceptedAt: "desc" }, take: 20, select: { id: true, acceptanceContext: true, acceptedAt: true, user: { select: { name: true, email: true } }, customerAccount: { select: { displayName: true } } } } } } }, orderBy: { title: "asc" } });
    return NextResponse.json(documents, { headers: { "cache-control": "private, no-store, max-age=0" } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const input = createSchema.parse(await request.json());
    const document = await db.$transaction(async (tx) => {
      const created = await tx.legalDocument.create({ data: input });
      await tx.auditLog.create({ data: { actorId: admin.id, action: "LEGAL_DOCUMENT_CREATED", targetType: "LegalDocument", targetId: created.id, metadata: { slug: created.slug, documentType: created.documentType } } });
      return created;
    });
    return NextResponse.json(document, { status: 201 });
  } catch (error) { return apiError(error); }
}
