import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../platform/persistence/generated/prisma/client";
import { assertStagingSettings } from "./deploy-staging.mjs";
import { legalContentHash, legalVariables, renderLegalMarkdown, type LegalVariables } from "../apps/web/legal/render";

export const STAGING_LEGAL_ACK = "I_APPROVE_THE_REVIEWED_STAGING_TEST_NOTICES";
export const STAGING_LEGAL_AUDIT_ACTION = "STAGING_TEST_LEGAL_NOTICES_INITIALIZED";
const sourceShaPattern = /^[a-f0-9]{40}$/i;
const noticeDefinitions = [
  { title: "Staging Test Terms", slug: "terms", documentType: "TERMS_OF_SERVICE", path: "../docs/legal/staging-test-terms.md" },
  { title: "Staging Test Privacy Notice", slug: "privacy", documentType: "PRIVACY_POLICY", path: "../docs/legal/staging-test-privacy.md" },
] as const;

export type StagingLegalNotice = {
  title: string;
  slug: string;
  documentType: "TERMS_OF_SERVICE" | "PRIVACY_POLICY";
  markdownContent: string;
  renderedHtml: string;
  contentHash: string;
};
export type StagingLegalAuthorization = {
  databaseUrl: URL;
  sourceSha: string;
  githubActor: string;
};
type DisconnectableClient = Pick<PrismaClient, "$disconnect">;
type BootstrapDatabase = DisconnectableClient & Pick<PrismaClient, "$transaction">;

function fail(code: string): never {
  throw new Error(code);
}

export function authorizeStagingLegalInitialization(env: NodeJS.ProcessEnv): StagingLegalAuthorization {
  if (env.NODE_ENV !== "production") fail("STAGING_LEGAL_PRODUCTION_REQUIRED");
  if (env.INITIALIZE_STAGING_LEGAL_ACK !== STAGING_LEGAL_ACK) fail("STAGING_LEGAL_ACK_REQUIRED");
  const sourceSha = env.SOURCE_SHA ?? "";
  const githubActor = env.GITHUB_ACTOR ?? "";
  if (!sourceShaPattern.test(sourceSha) || !/^[A-Za-z0-9-]{1,39}$/.test(githubActor)) fail("STAGING_LEGAL_PROVENANCE_REQUIRED");
  let databaseUrl: URL;
  try {
    databaseUrl = assertStagingSettings(env);
  } catch {
    fail("STAGING_LEGAL_CONFIGURATION_INVALID");
  }
  return { databaseUrl, sourceSha: sourceSha.toLowerCase(), githubActor };
}

export async function withAuthorizedStagingDatabase<T>(
  env: NodeJS.ProcessEnv,
  createClient: (databaseUrl: URL) => Promise<BootstrapDatabase> | BootstrapDatabase,
  operation: (client: BootstrapDatabase, authorization: StagingLegalAuthorization) => Promise<T>,
): Promise<T> {
  const authorization = authorizeStagingLegalInitialization(env);
  const client = await createClient(authorization.databaseUrl);
  try {
    return await operation(client, authorization);
  } finally {
    await client.$disconnect();
  }
}

export async function readStagingLegalNotices(variables: LegalVariables = legalVariables()): Promise<StagingLegalNotice[]> {
  return Promise.all(noticeDefinitions.map(async (definition) => {
    const markdownContent = await readFile(new URL(definition.path, import.meta.url), "utf8");
    const renderedHtml = renderLegalMarkdown(markdownContent, variables);
    return { ...definition, markdownContent, renderedHtml, contentHash: legalContentHash(renderedHtml) };
  }));
}

function expectedAuditDocuments(documents: Array<{ slug: string; id: string; currentPublishedVersionId: string | null; versions: Array<{ id: string; contentHash: string }> }>) {
  return documents.map((document) => ({
    slug: document.slug,
    documentId: document.id,
    versionId: document.versions[0]?.id,
    contentHash: document.versions[0]?.contentHash,
  })).sort((a, b) => a.slug.localeCompare(b.slug));
}

type ExistingLegalVersion = {
  id: string; versionNumber: number; markdownContent: string; renderedHtml: string | null; status: string;
  effectiveAt: Date | null; publishedAt: Date | null; archivedAt: Date | null; authorId: string | null;
  changeSummary: string; requiresReacceptance: boolean; contentHash: string;
};
type ExistingLegalDocument = {
  id: string; title: string; slug: string; documentType: string; status: string;
  currentPublishedVersionId: string | null; versions: ExistingLegalVersion[];
};
function isExactExistingState(
  documents: ExistingLegalDocument[],
  audits: Array<{ actorId: string | null; accountId: string | null; targetType: string; targetId: string | null; metadata: Prisma.JsonValue }>,
  notices: StagingLegalNotice[],
) {
  if (documents.length !== 2 || audits.length !== 1) return false;
  const bySlug = new Map(notices.map((notice) => [notice.slug, notice]));
  if (documents.some((document) => {
    const notice = bySlug.get(document.slug);
    if (!notice || document.title !== notice.title || document.documentType !== notice.documentType || document.status !== "ACTIVE" || !document.currentPublishedVersionId || document.versions.length !== 1) return true;
    const version = document.versions[0]!;
    return version.id !== document.currentPublishedVersionId
      || version.versionNumber !== 1
      || version.markdownContent !== notice.markdownContent
      || version.renderedHtml !== notice.renderedHtml
      || version.status !== "PUBLISHED"
      || !(version.effectiveAt instanceof Date)
      || !(version.publishedAt instanceof Date)
      || version.archivedAt !== null
      || version.authorId !== null
      || version.changeSummary !== "Initial Staging test notice"
      || version.requiresReacceptance !== true
      || version.contentHash !== notice.contentHash;
  })) return false;
  const audit = audits[0]!;
  if (audit.actorId !== null || audit.accountId !== null || audit.targetType !== "LegalDocumentBootstrap" || audit.targetId !== null) return false;
  const metadata = audit.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const record = metadata as Prisma.JsonObject;
  if (typeof record.sourceSha !== "string" || !sourceShaPattern.test(record.sourceSha)) return false;
  if (typeof record.githubActor !== "string" || !/^[A-Za-z0-9-]{1,39}$/.test(record.githubActor)) return false;
  const actual = record.documents;
  if (!Array.isArray(actual)) return false;
  const expected = expectedAuditDocuments(documents);
  if (actual.length !== expected.length) return false;
  return expected.every((entry, index) => {
    const item = actual[index];
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const stored = item as Prisma.JsonObject;
    const keys = Object.keys(stored).sort();
    return JSON.stringify(keys) === JSON.stringify(["contentHash", "documentId", "slug", "versionId"])
      && stored.slug === entry.slug
      && stored.documentId === entry.documentId
      && stored.versionId === entry.versionId
      && stored.contentHash === entry.contentHash;
  });
}

export async function initializeStagingLegalNoticesInTransaction(
  tx: Prisma.TransactionClient,
  notices: StagingLegalNotice[],
  authorization: Pick<StagingLegalAuthorization, "sourceSha" | "githubActor">,
  now = new Date(),
): Promise<"created" | "already-initialized"> {
  if (notices.length !== 2 || new Set(notices.map((notice) => notice.documentType)).size !== 2
    || !sourceShaPattern.test(authorization.sourceSha) || !/^[A-Za-z0-9-]{1,39}$/.test(authorization.githubActor)) fail("STAGING_LEGAL_NOTICE_SET_INVALID");
  const documents = await tx.legalDocument.findMany({ include: { versions: true } });
  const audits = await tx.auditLog.findMany({ where: { action: STAGING_LEGAL_AUDIT_ACTION } });
  if (documents.length > 0 || audits.length > 0) {
    if (isExactExistingState(documents, audits, notices)) return "already-initialized";
    fail("STAGING_LEGAL_EXISTING_STATE_CONFLICT");
  }
  if (await tx.user.count() !== 0) fail("STAGING_LEGAL_USERS_ALREADY_EXIST");

  const created: Array<{ slug: string; documentId: string; versionId: string; contentHash: string }> = [];
  for (const notice of notices) {
    const document = await tx.legalDocument.create({
      data: { title: notice.title, slug: notice.slug, documentType: notice.documentType, status: "ACTIVE" },
    });
    const version = await tx.legalDocumentVersion.create({
      data: {
        documentId: document.id,
        versionNumber: 1,
        markdownContent: notice.markdownContent,
        renderedHtml: notice.renderedHtml,
        status: "PUBLISHED",
        effectiveAt: now,
        publishedAt: now,
        authorId: null,
        changeSummary: "Initial Staging test notice",
        requiresReacceptance: true,
        contentHash: notice.contentHash,
      },
    });
    await tx.legalDocument.update({ where: { id: document.id }, data: { currentPublishedVersionId: version.id } });
    created.push({ slug: notice.slug, documentId: document.id, versionId: version.id, contentHash: notice.contentHash });
  }
  await tx.auditLog.create({
    data: {
      actorId: null,
      accountId: null,
      action: STAGING_LEGAL_AUDIT_ACTION,
      targetType: "LegalDocumentBootstrap",
      targetId: null,
      requestId: null,
      ipHash: null,
      metadata: { sourceSha: authorization.sourceSha, githubActor: authorization.githubActor, documents: created.sort((a, b) => a.slug.localeCompare(b.slug)) },
    },
  });
  return "created";
}

async function main() {
  await withAuthorizedStagingDatabase(process.env, (databaseUrl) => new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl.toString() }) }), async (client, authorization) => {
    const notices = await readStagingLegalNotices();
    await client.$transaction((tx) => initializeStagingLegalNoticesInTransaction(tx, notices, authorization), { isolationLevel: "Serializable" });
    console.info("Staging legal test notices initialized or already match the reviewed source.");
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const safeCodes = new Set([
      "STAGING_LEGAL_PRODUCTION_REQUIRED",
      "STAGING_LEGAL_ACK_REQUIRED",
      "STAGING_LEGAL_PROVENANCE_REQUIRED",
      "STAGING_LEGAL_CONFIGURATION_INVALID",
      "STAGING_LEGAL_NOTICE_SET_INVALID",
      "STAGING_LEGAL_EXISTING_STATE_CONFLICT",
      "STAGING_LEGAL_USERS_ALREADY_EXIST",
    ]);
    const message = error instanceof Error && safeCodes.has(error.message) ? error.message : "STAGING_LEGAL_INITIALIZATION_FAILED";
    console.error(message);
    process.exitCode = 1;
  });
}
