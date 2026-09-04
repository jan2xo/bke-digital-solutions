import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/v2/apps/web/http/api-error";
import { legalContentHash, legalVariables, renderLegalMarkdown } from "@/lib/legal/render";
import { pendingReacceptance } from "@/lib/legal/service";
import { assertSameOrigin, clientIp } from "@/v2/apps/web/http/request";
const schema = z.object({ versionIds: z.array(z.string().cuid()).min(1).max(20) }).strict();
export async function POST(request: Request) { try { assertSameOrigin(request); const user = await requireUser(); const input = schema.parse(await request.json()); const pending = await pendingReacceptance(user.id); const expected = pending.map(item => item.currentPublishedVersionId!); if (expected.length === 0) return NextResponse.json({ ok: true }); if (input.versionIds.length !== expected.length || expected.some(id => !input.versionIds.includes(id))) throw new Error("LEGAL_ACCEPTANCE_REQUIRED"); const variables = legalVariables(); await db.$transaction(async tx => { await tx.legalAcceptance.createMany({ data: pending.map(item => { const version = item.currentPublishedVersion!; return { userId: user.id, documentVersionId: version.id, acceptanceContext: "REACCEPTANCE", ipAddress: clientIp(request).slice(0, 128), userAgent: request.headers.get("user-agent")?.slice(0, 500), renderedContentHash: legalContentHash(renderLegalMarkdown(version.markdownContent, variables)), variablesSnapshot: variables }; }), skipDuplicates: true }); await tx.auditLog.create({ data: { actorId: user.id, action: "LEGAL_REACCEPTANCE_COMPLETED", targetType: "User", targetId: user.id, metadata: { versionIds: expected } } }); }); return NextResponse.json({ ok: true }); } catch (error) { return apiError(error); } }

