import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/apps/web/auth/session";
import { db } from "@/platform/host/db";
import { assertSameOrigin } from "@/apps/web/http/request";
import {
  assertSafeProductActivationModeChange,
  productActivationModes,
} from "@/apps/web/licensing/product-activation-mode";
import { audit } from "@/apps/web/audit";
import { apiError } from "@/apps/web/http/api-error";
import { resolveProductImageUrl } from "@/apps/web/catalog/product-image";
import {
  acceptedVersionSchema,
  assertProductIdChangeAllowed,
  productIdSchema,
  validateAcceptedVersionRange,
} from "@/apps/web/catalog/product-identity";

const launcherExecutionTypeSchema = z.enum(["LAUNCHER_PLUGIN", "STANDALONE"]);

const schema = z.object({
  productId: productIdSchema.optional(),
  minimumAcceptedVersion: acceptedVersionSchema.nullable().optional(),
  maximumAcceptedVersion: acceptedVersionSchema.nullable().optional(),
  launcherExecutionType: launcherExecutionTypeSchema.nullable().optional(),
  name: z.string().trim().min(2).max(120).optional(),
  slug: z.string().regex(/^[a-z0-9-]+$/).max(80).optional(),
  summary: z.string().trim().min(10).max(240).optional(),
  description: z.string().trim().min(10).max(10_000).optional(),
  category: z.string().trim().min(2).max(80).optional(),
  licenseType: z.string().trim().min(2).max(80).optional(),
  activationMode: z.enum(productActivationModes).optional(),
  featured: z.boolean().optional(),
  imageKey: z.string().trim().max(500).refine((value) => resolveProductImageUrl(value) !== null, "INVALID_IMAGE_URL").nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  action: z.enum(["PUBLISH", "UNPUBLISH", "ARCHIVE", "RESTORE"]).optional(),
}).strict();

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const admin = await requireAdmin();
    const { id } = await params;
    const body: unknown = await request.json();
    if (body && typeof body === "object" && "imageKey" in body) {
      const imageKey = (body as { imageKey?: unknown }).imageKey;
      if (imageKey !== null && imageKey !== undefined && !resolveProductImageUrl(imageKey)) throw new Error("INVALID_IMAGE_URL");
    }
    const input = schema.parse(body);

    const existing = await db.product.findUniqueOrThrow({
      where: { id },
      select: {
        productId: true,
        minimumAcceptedVersion: true,
        maximumAcceptedVersion: true,
        active: true,
        publishedAt: true,
        imageKey: true,
      },
    });

    validateAcceptedVersionRange(
      input.minimumAcceptedVersion !== undefined
        ? input.minimumAcceptedVersion
        : existing.minimumAcceptedVersion,
      input.maximumAcceptedVersion !== undefined
        ? input.maximumAcceptedVersion
        : existing.maximumAcceptedVersion,
    );

    if (input.productId !== undefined) {
      const [versions, licenses, subscriptions, orders] = await Promise.all([
        db.productVersion.count({ where: { productId: id } }),
        db.license.count({ where: { productId: id } }),
        db.subscription.count({ where: { productId: id } }),
        db.orderItem.count({ where: { productId: id } }),
      ]);
      assertProductIdChangeAllowed({
        existingProductId: existing.productId,
        requestedProductId: input.productId,
        lifecycleLocked: Boolean(
          existing.active ||
          existing.publishedAt ||
          versions ||
          licenses ||
          subscriptions ||
          orders
        ),
      });
    }

    const data = {
      productId: input.productId,
      minimumAcceptedVersion: input.minimumAcceptedVersion,
      maximumAcceptedVersion: input.maximumAcceptedVersion,
      name: input.name,
      slug: input.slug,
      summary: input.summary,
      description: input.description,
      category: input.category,
      licenseType: input.licenseType,
      featured: input.featured,
      imageKey: input.imageKey,
      tags: input.tags,
      ...(input.action === "PUBLISH"
        ? { active: true, publishedAt: new Date(), archivedAt: null }
        : input.action === "UNPUBLISH"
          ? { active: false, publishedAt: null }
          : input.action === "ARCHIVE"
            ? { active: false, archivedAt: new Date(), publishedAt: null }
            : input.action === "RESTORE"
              ? { archivedAt: null }
              : {}),
    };

    const product = await db.$transaction(async (tx) => {
      if (input.activationMode !== undefined) {
        // This same Product row lock serializes competing administrator changes
        // and prevents a late mode switch from silently stranding license keys.
        const rows = await tx.$queryRaw<Array<{
          activationMode: string;
          active: boolean;
          publishedAt: Date | null;
        }>>`
          SELECT policy."activationMode",
                 p."active", p."publishedAt"
            FROM "Product" p
            JOIN "ProductActivationPolicy" policy ON policy."productId" = p."id"
           WHERE p."id" = ${id}
           FOR UPDATE OF p, policy
        `;
        if (rows.length !== 1) throw new Error("PRODUCT_NOT_FOUND");
        const [versionsCount, licensesCount, orderItemsCount] = await Promise.all([
          tx.productVersion.count({ where: { productId: id } }),
          tx.license.count({ where: { productId: id } }),
          tx.orderItem.count({ where: { productId: id } }),
        ]);
        assertSafeProductActivationModeChange({
          previousMode: rows[0]!.activationMode,
          requestedMode: input.activationMode,
          active: rows[0]!.active,
          publishedAt: rows[0]!.publishedAt,
          versionsCount,
          licensesCount,
          orderItemsCount,
        });
        if (rows[0]!.activationMode !== input.activationMode) {
          // The policy decision and its audit must commit or roll back as one.
          await tx.auditLog.create({
            data: {
              actorId: admin.id,
              action: "PRODUCT_ACTIVATION_MODE_CHANGED",
              targetType: "Product",
              targetId: id,
              metadata: {
                previousMode: rows[0]!.activationMode,
                newMode: input.activationMode,
              },
            },
          });
        }
      }
      const updated = await tx.product.update({ where: { id }, data });
      if (input.activationMode !== undefined) {
        await tx.$executeRaw`
          INSERT INTO "ProductActivationPolicy" ("productId", "activationMode")
          VALUES (${id}, ${input.activationMode})
          ON CONFLICT ("productId") DO UPDATE
            SET "activationMode" = EXCLUDED."activationMode"
        `;
      }
      if (input.launcherExecutionType !== undefined) {
        await tx.$executeRaw`
          UPDATE "Product"
             SET "launcherExecutionType" =
               CAST(${input.launcherExecutionType ?? null} AS "LauncherExecutionType")
           WHERE "id" = ${id}
        `;
      }

      return updated;
    });

    const executionRows = await db.$queryRaw<
      Array<{ launcherExecutionType: "LAUNCHER_PLUGIN" | "STANDALONE" | null; activationMode: string }>
    >`
      SELECT p."launcherExecutionType"::text AS "launcherExecutionType",
             policy."activationMode" AS "activationMode"
        FROM "Product" p
        JOIN "ProductActivationPolicy" policy ON policy."productId" = p."id"
       WHERE p."id" = ${id}
       LIMIT 1
    `;

    await audit({
      actorId: admin.id,
      action: `PRODUCT_${input.action ?? "UPDATED"}`,
      targetType: "Product",
      targetId: id,
      metadata: { slug: product.slug, fields: Object.keys(input) },
    });

    return NextResponse.json({
      ...product,
      launcherExecutionType: executionRows[0]?.launcherExecutionType ?? null,
      activationMode: executionRows[0]?.activationMode ?? null,
    });
  } catch (error) {
    return apiError(error);
  }
}
