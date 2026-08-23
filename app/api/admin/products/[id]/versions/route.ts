import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security/request";

const fields = z.object({ version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/), minimumVersion: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/).optional().or(z.literal("")), maximumVersion: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/).optional().or(z.literal("")), externalUrl: z.string().url(), releaseNotes: z.string().max(10000).default("") }).strict();
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { id } = await params;
    const input = fields.parse(await request.json());
    const admin = await requireAdmin();
    const product = await db.product.findUnique({ where: { id } });
    if (!product) throw new Error("NOT_FOUND");
    const version = await db.$transaction(async (tx) => {
      const created = await tx.productVersion.create({ data: { productId: id, version: input.version, externalUrl: input.externalUrl, releaseNotes: input.releaseNotes, operatingSystem: "External", architecture: "any", lifecycle: "STABLE", active: true, publishedAt: new Date(), isLatest: true } });
      await tx.productVersion.updateMany({ where: { productId: id, id: { not: created.id } }, data: { isLatest: false } });
      await tx.product.update({ where: { id }, data: { minimumAcceptedVersion: input.minimumVersion === undefined ? product.minimumAcceptedVersion : input.minimumVersion || null, maximumAcceptedVersion: input.maximumVersion === undefined ? product.maximumAcceptedVersion : input.maximumVersion || null } });
      return created;
    });
    await audit({ actorId: admin.id, action: "PRODUCT_VERSION_CREATED", targetType: "ProductVersion", targetId: version.id, metadata: { productId: id, version: input.version, externalUrl: input.externalUrl } });
    return NextResponse.json({ id: version.id, version: version.version, externalUrl: version.externalUrl }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
