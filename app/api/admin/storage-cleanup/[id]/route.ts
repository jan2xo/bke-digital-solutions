import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRecentAdmin } from "@/lib/auth";
import { assertSameOrigin } from "@/v2/apps/web/http/request";
import { apiError } from "@/v2/apps/web/http/api-error";
import { processStorageCleanupJob, retryStorageCleanupJob } from "@/lib/storage-cleanup";

const schema = z.object({ action: z.enum(["RETRY", "PROCESS"]) }).strict();
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const admin = await requireRecentAdmin();
    const { id } = await params;
    const input = schema.parse(await request.json());
    if (input.action === "RETRY") await retryStorageCleanupJob(id, admin.id);
    const result = await processStorageCleanupJob(id);
    return NextResponse.json({ ok: true, result });
  } catch (error) { return apiError(error); }
}
