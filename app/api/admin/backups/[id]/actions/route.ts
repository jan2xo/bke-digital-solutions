import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRecentAdmin } from "@/lib/auth";
import { assertSameOrigin } from "@/v2/apps/web/http/request";
import { apiError } from "@/v2/apps/web/http/api-error";
import { requestBackupOperation } from "@/lib/backups/service";
import { rateLimit } from "@/v2/apps/web/http/rate-limit";
import { clientIp } from "@/v2/apps/web/http/request";
import { db } from "@/lib/db";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) { try { await requireRecentAdmin(); const operations = await db.backupOperation.findMany({ where: { backupId: (await params).id }, orderBy: { createdAt: "desc" }, take: 10 }); return NextResponse.json({ operations }); } catch (error) { return apiError(error); } }

const schema = z.object({
  action: z.enum(["VERIFY", "SIMULATE_RESTORE", "RESTORE_ISOLATED", "DELETE_EXPIRED"]),
  confirmation: z.string().max(200).optional(),
  dryRun: z.boolean().default(false),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const admin = await requireRecentAdmin();
    if (!(await rateLimit(`admin-backup-action:${admin.id}:${clientIp(request)}`, 30, 3600)).allowed) throw new Error("RATE_LIMITED");
    const { id } = await params;
    const input = schema.parse(await request.json());
    const operation = await requestBackupOperation({ backupId: id, type: input.action, actorId: admin.id, confirmation: input.confirmation, dryRun: input.dryRun });
    return NextResponse.json({ operationId: operation.id, status: operation.status }, { status: 202 });
  } catch (error) { return apiError(error); }
}
