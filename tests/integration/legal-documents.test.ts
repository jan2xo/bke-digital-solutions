import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../../generated/prisma/client";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userId = "";
let accountId = "";
let fixtureDocumentId = "";
let fixtureVersionId = "";

describe.sequential("legal document persistence and immutable acceptance history", () => {
  beforeAll(async () => {
    const user = await db.user.create({
      data: {
        email: `legal-${suffix}@bke.test`,
        name: "Legal Integration Customer",
        emailVerified: new Date(),
        ownedAccounts: { create: { type: "INDIVIDUAL", displayName: "Legal Integration Customer", billingEmail: `legal-${suffix}@bke.test` } },
      },
      include: { ownedAccounts: true },
    });
    userId = user.id;
    accountId = user.ownedAccounts[0]!.id;
  });

  afterAll(async () => db.$disconnect());

  it("records the exact current registration versions once", async () => {
    const { recordLegalAcceptances } = await import("@/lib/legal/service");
    const documents = await db.legalDocument.findMany({
      where: { documentType: { in: ["TERMS_OF_SERVICE", "PRIVACY_POLICY"] } },
      select: { currentPublishedVersionId: true },
    });
    const versionIds = documents.map((document) => document.currentPublishedVersionId!);
    const request = new Request("http://localhost/api/auth/register", { headers: { "user-agent": "legal-integration-test", "x-forwarded-for": "127.0.0.1" } });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await db.$transaction((tx) => recordLegalAcceptances(tx, { userId, customerAccountId: accountId, types: ["TERMS_OF_SERVICE", "PRIVACY_POLICY"], selectedVersionIds: versionIds, context: "REGISTRATION", request }));
    }
    const acceptances = await db.legalAcceptance.findMany({ where: { userId, acceptanceContext: "REGISTRATION" } });
    expect(acceptances).toHaveLength(2);
    expect(new Set(acceptances.map((acceptance) => acceptance.documentVersionId))).toEqual(new Set(versionIds));
    expect(acceptances.every((acceptance) => /^[a-f0-9]{64}$/.test(acceptance.renderedContentHash))).toBe(true);
  });

  it("enforces acceptance immutability in PostgreSQL", async () => {
    const acceptance = await db.legalAcceptance.findFirstOrThrow({ where: { userId } });
    await expect(db.legalAcceptance.update({ where: { id: acceptance.id }, data: { acceptanceContext: "TAMPERED" } })).rejects.toThrow(/immutable/i);
    await expect(db.legalAcceptance.delete({ where: { id: acceptance.id } })).rejects.toThrow(/immutable/i);
  });

  it("supports draft, publish, version history, reacceptance, and rollback", async () => {
    const document = await db.legalDocument.create({ data: { title: "Integration Legal Fixture", slug: `legal-fixture-${suffix}`, documentType: `TEST_LEGAL_${suffix.replaceAll("-", "_").toUpperCase()}` } });
    fixtureDocumentId = document.id;
    const first = await db.legalDocumentVersion.create({ data: { documentId: document.id, versionNumber: 1, markdownContent: "# Version one", contentHash: "1".repeat(64), changeSummary: "Initial fixture", status: "PUBLISHED", effectiveAt: new Date(), publishedAt: new Date() } });
    await db.legalDocument.update({ where: { id: document.id }, data: { currentPublishedVersionId: first.id } });
    const second = await db.legalDocumentVersion.create({ data: { documentId: document.id, versionNumber: 2, markdownContent: "# Version two", contentHash: "2".repeat(64), changeSummary: "Requires reacceptance", requiresReacceptance: true } });
    fixtureVersionId = second.id;
    await db.$transaction([
      db.legalDocumentVersion.update({ where: { id: first.id }, data: { status: "ARCHIVED", archivedAt: new Date() } }),
      db.legalDocumentVersion.update({ where: { id: second.id }, data: { status: "PUBLISHED", effectiveAt: new Date(), publishedAt: new Date() } }),
      db.legalDocument.update({ where: { id: document.id }, data: { currentPublishedVersionId: second.id } }),
    ]);
    const { pendingReacceptance } = await import("@/lib/legal/service");
    expect((await pendingReacceptance(userId)).some((item) => item.id === document.id)).toBe(true);
    const newerUser = await db.user.create({ data: { email: `legal-newer-${suffix}@bke.test`, name: "Newer Legal Customer", emailVerified: new Date() } });
    expect((await pendingReacceptance(newerUser.id)).some((item) => item.id === document.id)).toBe(false);
    await db.legalAcceptance.create({ data: { userId, documentVersionId: second.id, acceptanceContext: "REACCEPTANCE", renderedContentHash: "2".repeat(64), variablesSnapshot: {} } });
    expect((await pendingReacceptance(userId)).some((item) => item.id === document.id)).toBe(false);
    await db.$transaction([
      db.legalDocumentVersion.update({ where: { id: second.id }, data: { status: "ARCHIVED", archivedAt: new Date() } }),
      db.legalDocumentVersion.update({ where: { id: first.id }, data: { status: "PUBLISHED", archivedAt: null } }),
      db.legalDocument.update({ where: { id: document.id }, data: { currentPublishedVersionId: first.id } }),
    ]);
    expect((await db.legalDocument.findUniqueOrThrow({ where: { id: document.id } })).currentPublishedVersionId).toBe(first.id);
  });

  it("prevents published content changes and physical deletion", async () => {
    await expect(db.legalDocumentVersion.update({ where: { id: fixtureVersionId }, data: { markdownContent: "tampered" } })).rejects.toThrow(/immutable/i);
    await expect(db.legalDocumentVersion.delete({ where: { id: fixtureVersionId } })).rejects.toThrow(/cannot be deleted/i);
  });

  it("has the migration-level uniqueness and immutability protections installed", async () => {
    const indexes = await db.$queryRaw<Array<{ indexname: string }>>`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('LegalDocument', 'LegalAcceptance')`;
    expect(indexes.map((row) => row.indexname)).toContain("LegalDocument_documentType_key");
    expect(indexes.map((row) => row.indexname)).toContain("LegalAcceptance_user_version_context_null_account_key");
    const triggers = await db.$queryRaw<Array<{ tgname: string }>>`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('"LegalAcceptance"'::regclass, '"LegalDocumentVersion"'::regclass)`;
    expect(triggers.map((row) => row.tgname)).toEqual(expect.arrayContaining(["LegalAcceptance_immutable_update", "LegalAcceptance_immutable_delete", "LegalDocumentVersion_protect_update", "LegalDocumentVersion_protect_delete"]));
  });

  it("rejects a second document with the same semantic type", async () => {
    const source = await db.legalDocument.findUniqueOrThrow({ where: { id: fixtureDocumentId } });
    await expect(db.legalDocument.create({ data: { title: "Duplicate", slug: `duplicate-${suffix}`, documentType: source.documentType } })).rejects.toThrow();
  });
});
