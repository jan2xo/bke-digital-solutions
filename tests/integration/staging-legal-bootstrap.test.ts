import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, type Prisma } from "../../platform/host/generated/prisma/client";
import { initializeStagingLegalNoticesInTransaction, readStagingLegalNotices } from "../../scripts/initialize-staging-legal";

const enabled = process.env.RUN_STAGING_LEGAL_BOOTSTRAP_TESTS === "true";
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const authorization = { sourceSha: "a".repeat(40), githubActor: "ci-staging-legal-test" };
const rollback = new Error("rollback-only integration transaction");
const noticesPromise = readStagingLegalNotices({
  company_name: "BKE Digital Solutions",
  support_email: "staging@example.invalid",
  website: "https://bke-digital-solutions.jlprojectfreedom.workers.dev",
  business_address: "Staging test contact",
});

async function rollbackAfterAssertions(assertions: (tx: Prisma.TransactionClient) => Promise<void>) {
  try {
    await db.$transaction(async (tx) => {
      await assertions(tx);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

describe.skipIf(!enabled)("Staging legal notice bootstrap on a fresh disposable database", () => {
  beforeAll(async () => {
    expect(await db.user.count()).toBe(0);
    expect(await db.legalDocument.count()).toBe(0);
    expect(await db.auditLog.count({ where: { action: "STAGING_TEST_LEGAL_NOTICES_INITIALIZED" } })).toBe(0);
  });
  afterAll(async () => db.$disconnect());

  it("creates exactly the two published notices, reruns as a no-op, and creates no acceptance", async () => {
    const notices = await noticesPromise;
    await rollbackAfterAssertions(async (tx) => {
      expect(await initializeStagingLegalNoticesInTransaction(tx, notices, authorization)).toBe("created");
      expect(await initializeStagingLegalNoticesInTransaction(tx, notices, authorization)).toBe("already-initialized");
      const documents = await tx.legalDocument.findMany({ include: { versions: true } });
      expect(documents).toHaveLength(2);
      expect(documents.map((document) => document.documentType).sort()).toEqual(["PRIVACY_POLICY", "TERMS_OF_SERVICE"]);
      expect(documents.every((document) => document.status === "ACTIVE" && document.versions.length === 1)).toBe(true);
      expect(documents.every((document) => document.currentPublishedVersionId === document.versions[0]?.id)).toBe(true);
      expect(documents.every((document) => {
        const version = document.versions[0]!;
        const notice = notices.find((item) => item.documentType === document.documentType);
        if (!notice) return false;
        return version.status === "PUBLISHED" && version.versionNumber === 1 && version.requiresReacceptance
          && version.authorId === null && version.markdownContent === notice?.markdownContent
          && version.renderedHtml === notice?.renderedHtml && version.contentHash === notice.contentHash
          && version.effectiveAt instanceof Date && version.publishedAt instanceof Date
          && /^[a-f0-9]{64}$/.test(version.contentHash);
      })).toBe(true);
      const audit = await tx.auditLog.findFirstOrThrow({ where: { action: "STAGING_TEST_LEGAL_NOTICES_INITIALIZED" } });
      expect(audit.actorId).toBeNull();
      expect(audit.metadata).toMatchObject({
        sourceSha: authorization.sourceSha,
        githubActor: authorization.githubActor,
        documents: expect.arrayContaining(documents.map((document) => expect.objectContaining({
          documentId: document.id,
          versionId: document.versions[0]?.id,
          contentHash: document.versions[0]?.contentHash,
        }))),
      });
      expect(await tx.legalAcceptance.count()).toBe(0);
      await tx.user.create({ data: { email: "staging-legal-bootstrap@bke.test", name: "Disposable bootstrap test" } });
      expect(await initializeStagingLegalNoticesInTransaction(tx, notices, authorization)).toBe("already-initialized");
      expect(await tx.legalAcceptance.count()).toBe(0);
    });
    expect(await db.legalDocument.count()).toBe(0);
    expect(await db.user.count()).toBe(0);
    expect(await db.auditLog.count({ where: { action: "STAGING_TEST_LEGAL_NOTICES_INITIALIZED" } })).toBe(0);
  });

  it("refuses unexpected partial legal state without retaining writes", async () => {
    const notices = await noticesPromise;
    await rollbackAfterAssertions(async (tx) => {
      await tx.legalDocument.create({ data: { title: "Unexpected", slug: "terms", documentType: "TERMS_OF_SERVICE" } });
      await expect(initializeStagingLegalNoticesInTransaction(tx, notices, authorization)).rejects.toThrow("STAGING_LEGAL_EXISTING_STATE_CONFLICT");
      throw rollback;
    });
    expect(await db.legalDocument.count()).toBe(0);
    expect(await db.legalDocumentVersion.count()).toBe(0);
  });

  it("refuses first initialization once any user exists", async () => {
    const notices = await noticesPromise;
    await rollbackAfterAssertions(async (tx) => {
      await tx.user.create({ data: { email: "existing-staging-user@bke.test", name: "Existing disposable user" } });
      await expect(initializeStagingLegalNoticesInTransaction(tx, notices, authorization)).rejects.toThrow("STAGING_LEGAL_USERS_ALREADY_EXIST");
      throw rollback;
    });
    expect(await db.user.count()).toBe(0);
    expect(await db.legalDocument.count()).toBe(0);
  });
});
