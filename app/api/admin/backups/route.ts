import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireRecentAdmin } from "@/lib/auth";
import { assertSameOrigin } from "@/v2/apps/web/http/request";
import { apiError } from "@/v2/apps/web/http/api-error";
import { db } from "@/lib/db";
import { requestBackup } from "@/lib/backups/service";
import { rateLimit } from "@/v2/apps/web/http/rate-limit";
import { clientIp } from "@/v2/apps/web/http/request";

const createSchema = z.object({ dryRun: z.boolean().default(false) });

export async function GET() {
  try {
    await requireAdmin();
    const [backups, operations] = await Promise.all([
      db.backupArchive.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
      db.backupOperation.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    ]);
    return NextResponse.json({ backups: backups.map((item) => ({ ...item, sizeBytes: item.sizeBytes.toString() })), operations });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireRecentAdmin();
    if (!(await rateLimit(`admin-backup:${admin.id}:${clientIp(request)}`, 20, 3600)).allowed) throw new Error("RATE_LIMITED");
    const input = createSchema.parse(await request.json());
    const operation = await requestBackup({ actorId: admin.id, trigger: "MANUAL", dryRun: input.dryRun });
    return NextResponse.json({ operationId: operation.id, backupId: operation.backupId, status: operation.status }, { status: 202 });
  } catch (error) { return apiError(error); }
}
