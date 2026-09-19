import "server-only";

import type { Prisma } from "@/platform/persistence/generated/prisma/client";

export const launcherExecutionTypes = [
  "LAUNCHER_PLUGIN",
  "STANDALONE",
] as const;

export type LauncherExecutionType = (typeof launcherExecutionTypes)[number];

export type AgentSoftwareCatalogItem = Readonly<{
  productId: string;
  displayName: string;
  summary: string;
  executionType: LauncherExecutionType | null;
  entitled: boolean;
  installable: boolean;
  latestVersion: string | null;
}>;

type CatalogRow = Readonly<{
  productId: string;
  displayName: string;
  summary: string;
  executionType: string | null;
  latestVersion: string | null;
  entitled: boolean;
}>;

function validExecutionType(value: string | null): value is LauncherExecutionType {
  return value === "LAUNCHER_PLUGIN" || value === "STANDALONE";
}

export function projectAgentSoftwareCatalogRow(row: CatalogRow): AgentSoftwareCatalogItem {
  const executionType = validExecutionType(row.executionType)
    ? row.executionType
    : null;
  const entitled = row.entitled === true;
  const latestVersion = row.latestVersion?.trim() || null;

  return Object.freeze({
    productId: row.productId,
    displayName: row.displayName,
    summary: row.summary,
    executionType,
    entitled,
    installable: entitled && executionType !== null && latestVersion !== null,
    latestVersion,
  });
}

export async function readAgentSoftwareCatalog(
  tx: Prisma.TransactionClient,
  input: Readonly<{
    accountId: string;
    platform: "windows" | "macos" | "linux";
    architecture: "x64" | "arm64" | "x86";
  }>,
): Promise<readonly AgentSoftwareCatalogItem[]> {
  const rows = await tx.$queryRaw<CatalogRow[]>`
    SELECT
      p."productId" AS "productId",
      p."name" AS "displayName",
      p."summary" AS "summary",
      p."launcherExecutionType"::text AS "executionType",
      release."version" AS "latestVersion",
      EXISTS (
        SELECT 1
          FROM "Entitlement" e
         WHERE e."subjectId" = ${input.accountId}
           AND (
             e."resourceId" = p."id"
             OR EXISTS (
               SELECT 1
                 FROM "Edition" entitlement_edition
                WHERE entitlement_edition."id" = e."resourceId"
                  AND entitlement_edition."productId" = p."id"
             )
           )
           AND e."status" = 'ACTIVE'
           AND e."validFrom" <= NOW()
           AND (e."validUntil" IS NULL OR e."validUntil" > NOW())
      ) AS "entitled"
    FROM "Product" p
    LEFT JOIN LATERAL (
      SELECT pv."version"
        FROM "ProductVersion" pv
       WHERE pv."productId" = p."id"
         AND pv."active" = TRUE
         AND pv."lifecycle" IN ('STABLE', 'LTS')
         AND LOWER(pv."operatingSystem") = ${input.platform}
         AND LOWER(pv."architecture") = ${input.architecture}
       ORDER BY pv."isLatest" DESC, pv."releasedAt" DESC
       LIMIT 1
    ) release ON TRUE
    WHERE p."productId" IS NOT NULL
      AND p."active" = TRUE
      AND p."publishedAt" IS NOT NULL
      AND p."archivedAt" IS NULL
    ORDER BY p."name" ASC, p."productId" ASC
  `;

  return Object.freeze(rows.map(projectAgentSoftwareCatalogRow));
}
