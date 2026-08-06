import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireRecentAdmin } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/security/request";
import { apiError } from "@/lib/http";
import { db } from "@/lib/db";
import { requestBackup } from "@/lib/backups/service";

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
    const input = createSchema.parse(await request.json());
    const operation = await requestBackup({ actorId: admin.id, trigger: "MANUAL", dryRun: input.dryRun });
    return NextResponse.json({ operationId: operation.id, backupId: operation.backupId, status: operation.status }, { status: 202 });
  } catch (error) { return apiError(error); }
}
