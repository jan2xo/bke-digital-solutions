import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRecentAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertSameOrigin } from "@/v2/apps/web/http/request";
import { audit } from "@/v2/apps/web/audit";
import { apiError } from "@/v2/apps/web/http/api-error";
import { rateLimit } from "@/v2/apps/web/http/rate-limit";

const stages = ["DRAFT", "INTERNAL", "ALPHA", "BETA", "RELEASE_CANDIDATE", "STABLE", "LTS", "DEPRECATED", "ARCHIVED"] as const;
const schema = z.object({
  lifecycle: z.enum(stages).optional(),
  published: z.boolean().optional(),
  latest: z.boolean().optional(),
  releaseNotes: z.string().max(10000).optional(),
  changelog: z.string().max(20000).optional(),
  channel: z.enum(["STABLE", "BETA"]).optional(),
  deprecated: z.boolean().optional(),
  rollback: z.boolean().optional(),
  notes: z.string().trim().max(4000).optional(),
  approve: z.boolean().optional(),
  reviewed: z.boolean().optional(),
  breakGlass: z.boolean().optional(),
  breakGlassJustification: z.string().trim().max(4000).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const admin = await requireRecentAdmin();
    const { id } = await params;
    const input = schema.parse(await request.json());
    if (!(await rateLimit(`admin-release-lifecycle:${admin.id}:${id}`, 20, 3600)).allowed) throw new Error("RATE_LIMITED");

    const current = await db.productVersion.findUniqueOrThrow({ where: { id } });
    const targetLifecycle = input.lifecycle ?? current.lifecycle;

    if (input.published === true && !["STABLE", "LTS"].includes(targetLifecycle)) {
      throw new Error("RELEASE_PUBLICATION_REQUIRES_STABLE");
    }

    if (input.lifecycle) {
      const from = stages.indexOf(current.lifecycle as (typeof stages)[number]);
      const to = stages.indexOf(input.lifecycle);
      if (
        input.lifecycle !== current.lifecycle &&
        to !== from + 1 &&
        !(input.lifecycle === "DEPRECATED" && from >= stages.indexOf("STABLE")) &&
        !(input.lifecycle === "ARCHIVED" && current.lifecycle === "DEPRECATED")
      ) {
        throw new Error("INVALID_RELEASE_TRANSITION");
      }
    }

    const version = await db.$transaction(async (tx) => {
      if (input.published === true) {
        await tx.productVersion.updateMany({
          where: {
            productId: current.productId,
            id: { not: id },
            isLatest: true,
          },
          data: { isLatest: false },
        });
      }

      const now = new Date();
      const updated = await tx.productVersion.update({
        where: { id },
        data: {
          lifecycle: input.lifecycle,
          releaseNotes: input.releaseNotes,
          changelog: input.changelog,
          channel: input.channel,
          active: input.lifecycle === "ARCHIVED" ? false : undefined,
          publishedAt: input.published === true ? now : input.published === false ? null : undefined,
          isLatest: input.published === true ? true : input.published === false || input.lifecycle === "ARCHIVED" || input.lifecycle === "DEPRECATED" ? false : undefined,
          deprecatedAt: input.lifecycle === "DEPRECATED" ? now : input.lifecycle ? null : undefined,
        },
      });

      if (input.lifecycle === "ARCHIVED" || input.lifecycle === "DEPRECATED" || input.published === false) {
        const fallback = await tx.productVersion.findFirst({
          where: {
            productId: current.productId,
            id: { not: id },
            active: true,
            publishedAt: { not: null },
            lifecycle: { in: ["STABLE", "LTS"] },
          },
          orderBy: [{ publishedAt: "desc" }, { releasedAt: "desc" }],
        });
        if (fallback) await tx.productVersion.update({ where: { id: fallback.id }, data: { isLatest: true } });
      }

      return updated;
    });

    await audit({
      actorId: admin.id,
      action: "RELEASE_CATALOG_METADATA_CHANGED",
      targetType: "ProductVersion",
      targetId: id,
      metadata: {
        lifecycle: input.lifecycle,
        published: input.published,
        channel: input.channel,
        releaseAuthority: "GITHUB",
        notes: input.notes ?? "",
      },
    });

    return NextResponse.json(version);
  } catch (error) {
    return apiError(error);
  }
}
