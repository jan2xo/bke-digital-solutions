import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRecentAdmin } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/security/request";
import { apiError } from "@/lib/http";
import { requestBackupOperation } from "@/lib/backups/service";

const schema = z.object({
  action: z.enum(["VERIFY", "SIMULATE_RESTORE", "RESTORE_ISOLATED", "DELETE_EXPIRED"]),
  confirmation: z.string().max(200).optional(),
  dryRun: z.boolean().default(false),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const admin = await requireRecentAdmin();
    const { id } = await params;
    const input = schema.parse(await request.json());
    const operation = await requestBackupOperation({ backupId: id, type: input.action, actorId: admin.id, confirmation: input.confirmation, dryRun: input.dryRun });
    return NextResponse.json({ operationId: operation.id, status: operation.status }, { status: 202 });
  } catch (error) { return apiError(error); }
}
