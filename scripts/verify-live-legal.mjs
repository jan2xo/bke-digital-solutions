import { pathToFileURL } from "node:url";
import { assertLiveSettings } from "./prepare-live-paymongo.mjs";

export const requiredCommercialDocumentTypes = Object.freeze([
  "TERMS_OF_SERVICE",
  "PRIVACY_POLICY",
  "SOFTWARE_LICENSE_AGREEMENT",
  "REFUND_POLICY",
  "SUBSCRIPTION_TERMS",
]);

const disallowedTestNotice = /\bREVIEW\s+DRAFT\b|\bTEST[- ]ONLY\b|\bNONCOMMERCIAL\b|\bMOCK\s+(?:CHECKOUT|PAYMENT)\b/i;

function reject() {
  throw new Error("LIVE_LEGAL_APPROVAL_REQUIRED");
}

export function assertPublishedCommercialLegal(rows, now = new Date()) {
  if (!Array.isArray(rows) || !(now instanceof Date) || !Number.isFinite(now.getTime())) reject();
  const byType = new Map();
  for (const row of rows) {
    if (typeof row?.type !== "string" || byType.has(row.type)) reject();
    byType.set(row.type, row);
  }

  for (const type of requiredCommercialDocumentTypes) {
    const row = byType.get(type);
    if (!row || row.docStatus !== "ACTIVE" || row.versionStatus !== "PUBLISHED") reject();
    if (row.publishedAt == null) reject();
    const publication = new Date(row.publishedAt);
    if (!Number.isFinite(publication.getTime()) || publication > now) reject();
    if (row.effectiveAt != null) {
      const effective = new Date(row.effectiveAt);
      if (!Number.isFinite(effective.getTime()) || effective > now) reject();
    }
    if (typeof row.contentHash !== "string" || !/^[a-f0-9]{64}$/i.test(row.contentHash)) reject();
    if (typeof row.markdownContent !== "string" || !row.markdownContent.trim()) reject();
    const content = [row.title, row.markdownContent, row.renderedHtml]
      .filter((value) => typeof value === "string").join("\n");
    if (disallowedTestNotice.test(content)) reject();
  }
  return true;
}

async function main() {
  const direct = assertLiveSettings(process.env);
  const { default: pg } = await import("pg");
  const client = new pg.Client({
    connectionString: direct.href,
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 10000,
    statement_timeout: 10000,
    application_name: "bke_live_commercial_legal_verify",
  });
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    const statement = [
      'SELECT d."documentType" AS "type", d."title" AS "title",',
      'd."status" AS "docStatus", v."status" AS "versionStatus",',
      'v."publishedAt" AS "publishedAt", v."effectiveAt" AS "effectiveAt",',
      'v."markdownContent" AS "markdownContent", v."renderedHtml" AS "renderedHtml",',
      'v."contentHash" AS "contentHash"',
      'FROM "LegalDocument" d',
      'LEFT JOIN "LegalDocumentVersion" v ON v."id" = d."currentPublishedVersionId"',
      'WHERE d."documentType" = ANY($1::text[])',
    ].join(" ");
    const { rows } = await client.query(statement, [requiredCommercialDocumentTypes]);
    assertPublishedCommercialLegal(rows);
    await client.query("ROLLBACK");
    console.info("PASS: live commercial legal publication structure; separate owner legal approval remains required.");
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error && /^LIVE_LEGAL_[A-Z_]+$/.test(error.message)
      ? error.message : "LIVE_LEGAL_READINESS_UNAVAILABLE");
    process.exitCode = 1;
  });
}
