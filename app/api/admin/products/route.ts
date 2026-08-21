import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertSameOrigin } from "@/lib/security/request";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/http";
import { createEdition, editionPlanSchema } from "@/lib/edition-plans";
import { productIdSchema } from "@/lib/product-identity";

const schema = z.object({
  productId: productIdSchema,
  slug: z.string().regex(/^[a-z0-9-]+$/).max(80),
  name: z.string().trim().min(2).max(120),
  summary: z.string().trim().min(10).max(240),
  description: z.string().trim().min(10).max(10_000),
  type: z.enum(["SOFTWARE", "SAAS", "HYBRID"]).default("SOFTWARE"),
  category: z.string().trim().min(2).max(80).default("General"),
  licenseType: z.string().trim().min(2).max(80).default("Commercial"),
  featured: z.boolean().default(false),
  imageKey: z.string().trim().max(500).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  edition: editionPlanSchema,
}).strict();

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json(await db.product.findMany({ include: { editions: { include: { purchasePlans: true } }, versions: { orderBy: { releasedAt: "desc" } } }, orderBy: { createdAt: "desc" } }));
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const input = schema.parse(await request.json());
    const product = await db.$transaction(async (tx) => {
      const created = await tx.product.create({ data: { productId: input.productId, slug: input.slug, name: input.name, summary: input.summary, description: input.description, type: input.type, category: input.category, licenseType: input.licenseType, featured: input.featured, imageKey: input.imageKey, tags: input.tags, active: false } });
      await createEdition(tx, created.id, input.edition);
      return created;
    });
    await audit({ actorId: admin.id, action: "PRODUCT_CREATED", targetType: "Product", targetId: product.id, metadata: { slug: product.slug, category: product.category, edition: input.edition.name, planTypes: Object.entries(input.edition.plans).filter(([, value]) => value.enabled).map(([type]) => type) } });
    return NextResponse.json(product, { status: 201 });
  } catch (error) { return apiError(error); }
}
