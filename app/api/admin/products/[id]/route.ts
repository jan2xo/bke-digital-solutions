import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertSameOrigin } from "@/lib/security/request";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/http";
import { acceptedVersionSchema, productIdSchema, validateAcceptedVersionRange } from "@/lib/product-identity";

const schema = z.object({ productId: productIdSchema.optional(), minimumAcceptedVersion: acceptedVersionSchema.nullable().optional(), maximumAcceptedVersion: acceptedVersionSchema.nullable().optional(), name: z.string().trim().min(2).max(120).optional(), slug: z.string().regex(/^[a-z0-9-]+$/).max(80).optional(), summary: z.string().trim().min(10).max(240).optional(), description: z.string().trim().min(10).max(10_000).optional(), category: z.string().trim().min(2).max(80).optional(), licenseType: z.string().trim().min(2).max(80).optional(), featured: z.boolean().optional(), imageKey: z.string().trim().max(500).nullable().optional(), tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(), action: z.enum(["PUBLISH", "UNPUBLISH", "ARCHIVE", "RESTORE"]).optional() }).strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request); const admin = await requireAdmin(); const { id } = await params; const input = schema.parse(await request.json());
    const existing = await db.product.findUniqueOrThrow({ where: { id }, select: { productId: true, minimumAcceptedVersion: true, maximumAcceptedVersion: true, active: true, publishedAt: true } });
    validateAcceptedVersionRange(input.minimumAcceptedVersion !== undefined ? input.minimumAcceptedVersion : existing.minimumAcceptedVersion, input.maximumAcceptedVersion !== undefined ? input.maximumAcceptedVersion : existing.maximumAcceptedVersion);
    if (input.productId !== undefined && input.productId !== existing.productId) {
      const [versions, licenses, subscriptions, orders] = await Promise.all([db.productVersion.count({ where: { productId: id } }), db.license.count({ where: { productId: id } }), db.subscription.count({ where: { productId: id } }), db.orderItem.count({ where: { productId: id } })]);
      if (existing.active || existing.publishedAt || versions || licenses || subscriptions || orders) throw new Error("PRODUCT_ID_IMMUTABLE");
    }
    const data = { productId: input.productId, minimumAcceptedVersion: input.minimumAcceptedVersion, maximumAcceptedVersion: input.maximumAcceptedVersion, name: input.name, slug: input.slug, summary: input.summary, description: input.description, category: input.category, licenseType: input.licenseType, featured: input.featured, imageKey: input.imageKey, tags: input.tags, ...input.action === "PUBLISH" ? { active: true, publishedAt: new Date(), archivedAt: null } : input.action === "UNPUBLISH" ? { active: false, publishedAt: null } : input.action === "ARCHIVE" ? { active: false, archivedAt: new Date(), publishedAt: null } : input.action === "RESTORE" ? { archivedAt: null } : {} };
    const product = await db.product.update({ where: { id }, data });
    await audit({ actorId: admin.id, action: `PRODUCT_${input.action ?? "UPDATED"}`, targetType: "Product", targetId: id, metadata: { slug: product.slug, fields: Object.keys(input) } });
    return NextResponse.json(product);
  } catch (error) { return apiError(error); }
}
