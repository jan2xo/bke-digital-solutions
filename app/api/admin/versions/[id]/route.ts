import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRecentAdmin } from "@/apps/web/auth/session";
import { db } from "@/platform/host/db";
import { assertSameOrigin } from "@/apps/web/http/request";
import { audit } from "@/apps/web/audit";
import { apiError } from "@/apps/web/http/api-error";
import { rateLimit } from "@/apps/web/http/rate-limit";
import {
  StandaloneReleaseContractError,
  type StandaloneReleaseContractProof,
  verifyGitHubStandaloneReleaseContract,
} from "@/platform/distribution/github-standalone-release";

const stages = ["DRAFT", "INTERNAL", "ALPHA", "BETA", "RELEASE_CANDIDATE", "STABLE", "LTS", "DEPRECATED", "ARCHIVED"] as const;
const schema = z.object({
  lifecycle: z.enum(stages).optional(),
  published: z.boolean().optional(),
  latest: z.boolean().optional(),
  releaseNotes: z.string().max(10000).optional(),
  changelog: z.string().max(20000).optional(),
  channel: z.enum(["STABLE", "BETA"]).optional(),
  operatingSystem: z.enum(["Windows", "macOS", "Linux"]).optional(),
  architecture: z.enum(["x64", "arm64", "universal"]).optional(),
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

    const current = await db.productVersion.findUniqueOrThrow({
      where: { id },
      include: {
        product: {
          select: {
            productId: true,
            launcherExecutionType: true,
          },
        },
        supplyChainEvidence: {
          select: { id: true },
        },
      },
    });
    const targetLifecycle = input.lifecycle ?? current.lifecycle;
    const compatibilityChange =
      input.operatingSystem !== undefined ||
      input.architecture !== undefined;

    if (compatibilityChange && current.publishedAt !== null) {
      throw new Error("RELEASE_COMPATIBILITY_EDIT_REQUIRES_UNPUBLISH");
    }

    if (input.published === true && !["STABLE", "LTS"].includes(targetLifecycle)) {
      throw new Error("RELEASE_PUBLICATION_REQUIRES_STABLE");
    }

    let standaloneReleaseProofs: readonly StandaloneReleaseContractProof[] = [];
    if (
      input.published === true &&
      current.product.launcherExecutionType === "STANDALONE"
    ) {
      const productId = current.product.productId?.trim();
      const operatingSystem =
        input.operatingSystem ?? current.operatingSystem;
      const architecture =
        input.architecture ?? current.architecture;

      if (
        !productId ||
        !current.supplyChainEvidence ||
        operatingSystem !== "Windows" ||
        !["x64", "arm64", "universal"].includes(architecture)
      ) {
        throw new Error("RELEASE_DISTRIBUTION_CONTRACT_INVALID");
      }

      try {
        standaloneReleaseProofs =
          await verifyGitHubStandaloneReleaseContract({
            productId,
            version: current.version,
            platform: "windows",
            architecture: architecture as "x64" | "arm64" | "universal",
          });
      } catch (error) {
        if (error instanceof StandaloneReleaseContractError) {
          throw new Error(error.code);
        }
        throw error;
      }
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

        if (
          current.product.launcherExecutionType === "STANDALONE" &&
          current.supplyChainEvidence
        ) {
          await tx.supplyChainVerificationEvidence.deleteMany({
            where: {
              evidenceId: current.supplyChainEvidence.id,
              kind: "GITHUB_RELEASE_CONTRACT",
            },
          });

          if (standaloneReleaseProofs.length === 0) {
            throw new Error("RELEASE_DISTRIBUTION_CONTRACT_INVALID");
          }

          await tx.supplyChainVerificationEvidence.createMany({
            data: standaloneReleaseProofs.map((proof) => ({
              evidenceId: current.supplyChainEvidence!.id,
              kind: "GITHUB_RELEASE_CONTRACT",
              artifactHash: proof.packageSha256,
              result: "VERIFIED",
              reference:
                `https://github.com/${proof.repository}/releases/tag/${proof.tag}`,
              metadata: { ...proof },
            })),
          });
        }
      }

      const now = new Date();
      const updated = await tx.productVersion.update({
        where: { id },
        data: {
          lifecycle: input.lifecycle,
          releaseNotes: input.releaseNotes,
          changelog: input.changelog,
          channel: input.channel,
          operatingSystem: input.operatingSystem,
          architecture: input.architecture,
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
        operatingSystem: input.operatingSystem,
        architecture: input.architecture,
        releaseAuthority: "GITHUB",
        releaseContractVerified:
          standaloneReleaseProofs.length > 0,
        releaseContractArchitectures:
          standaloneReleaseProofs.map((proof) => proof.architecture),
        notes: input.notes ?? "",
      },
    });

    return NextResponse.json(version);
  } catch (error) {
    return apiError(error);
  }
}
