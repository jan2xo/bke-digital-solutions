import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireRecentAdmin } from "@/lib/auth";
import { audit } from "@/v2/apps/web/audit";
import { evaluateProductDeletionEligibility, finalizeProductDeletion, requestProductDeletion, ProductDeletionError } from "@/lib/product-deletion";
import { processStorageCleanupJob } from "@/lib/storage-cleanup";
import { db } from "@/lib/db";
import { assertSameOrigin } from "@/v2/apps/web/http/request";
import { apiError } from "@/v2/apps/web/http/api-error";

const idSchema = z.string().cuid();
const bodySchema = z.object({ confirmationName: z.string().min(1).max(120) }).strict();
const noStore = { "cache-control": "no-store" };

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;
    const eligibility = await evaluateProductDeletionEligibility(idSchema.parse(id));
    if (!eligibility.productExists) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404, headers: noStore });
    const cleanupJobs = await db.storageCleanupJob.groupBy({ by: ["status"], where: { productId: id }, _count: true });
    return NextResponse.json({ ...eligibility, cleanupJobs }, { headers: noStore });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let admin: Awaited<ReturnType<typeof requireAdmin>> | undefined;
  let productId: string | undefined;
  try {
    assertSameOrigin(request);
    admin = await requireRecentAdmin();
    productId = idSchema.parse((await params).id);
    const input = bodySchema.parse(await request.json());
    const result = await requestProductDeletion({ productId, actorId: admin.id, confirmationName: input.confirmationName });
    return NextResponse.json({ status: "CLEANUP_PENDING", queuedJobs: result.queuedJobs }, { status: 202, headers: noStore });
  } catch (error) {
    if (error instanceof ProductDeletionError) {
      if (admin && productId && error.code !== "NOT_FOUND") {
        await audit({
          actorId: admin.id,
        action: error.code === "STORAGE_CLEANUP_FAILED" ? "PRODUCT_DELETE_STORAGE_CLEANUP_FAILED" : "PRODUCT_DELETE_BLOCKED",
          targetType: "Product",
          targetId: productId,
          metadata: {
            reason: error.eligibility?.reason,
            dependencies: error.eligibility?.blockingDependencies,
          },
        });
      }
      if (error.code === "NOT_FOUND") return NextResponse.json({ error: "NOT_FOUND" }, { status: 404, headers: noStore });
      if (error.code === "STORAGE_CLEANUP_FAILED") {
        return NextResponse.json({ error: error.code, message: "Private storage cleanup failed. The product remains archived and the operation can be retried." }, { status: 503, headers: noStore });
      }
      return NextResponse.json({
        error: "PRODUCT_DELETE_BLOCKED",
        message: error.eligibility?.reason === "PRODUCT_NOT_ARCHIVED"
          ? "Only archived products can be permanently deleted."
          : error.eligibility?.productName
            ? "This product cannot be permanently deleted because the confirmation or preserved dependencies do not allow it."
            : "This product cannot be permanently deleted.",
        reason: error.eligibility?.reason,
        dependencies: error.eligibility?.blockingDependencies,
      }, { status: 409, headers: noStore });
    }
    return apiError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const admin = await requireRecentAdmin();
    const productId = idSchema.parse((await params).id);
    const jobs = await db.storageCleanupJob.findMany({ where: { productId, status: { in: ["PENDING", "RETRYING"] } }, select: { id: true } });
    for (const job of jobs) await processStorageCleanupJob(job.id);
    await finalizeProductDeletion({ productId, actorId: admin.id });
    return new NextResponse(null, { status: 204, headers: noStore });
  } catch (error) {
    if (error instanceof ProductDeletionError) return NextResponse.json({ error: error.code }, { status: error.code === "STORAGE_CLEANUP_FAILED" ? 503 : 409, headers: noStore });
    return apiError(error);
  }
}
