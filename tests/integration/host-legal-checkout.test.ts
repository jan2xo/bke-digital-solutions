import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { describe, expect, it, afterAll } from "vitest";
import { PrismaClient } from "../../platform/host/generated/prisma/client";
import { createLegalCheckoutRequirementsCapability } from "@bke/legal/logic/checkout-requirements";
import { createLegalAcceptanceCapability } from "@bke/legal/logic/acceptance";
import { legalRenderedContentSha256, renderLegalMarkdown } from "@bke/legal/logic/render";
import {
  createHostLegalCheckoutRequirementsRepository,
  createHostLegalAcceptanceRepository,
} from "../../apps/web/legal/checkout-repositories";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const rollback = new Error("ROLLBACK_HOST_LEGAL_FIXTURE");
afterAll(async () => db.$disconnect());

describe("V3 host Legal checkout compatibility (real PostgreSQL)", { concurrent: false }, () => {
  it("returns a missing-notice status, not persistence failure, when checkout agreements are unpublished", async () => {
    // Seeded CI can already have checkout notices. Hide the refund notice
    // inside a rollback-only real transaction to prove the missing-document
    // receiving path without mutating disposable test fixtures.
    let result: Awaited<ReturnType<ReturnType<typeof createLegalCheckoutRequirementsCapability>["resolve"]>> | undefined;
    try {
      await db.$transaction(async (tx) => {
        const refund = await tx.legalDocument.findFirst({ where: { documentType: "REFUND_POLICY" } });
        if (refund) await tx.legalDocument.update({
          where: { id: refund.id },
          data: { currentPublishedVersionId: null },
        });
        const required = createLegalCheckoutRequirementsCapability(
          createHostLegalCheckoutRequirementsRepository(tx),
        );
        result = await required.resolve({ planType: "PERPETUAL" });
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    expect(result).toEqual({ status: "FAILED", code: "LEGAL_DOCUMENTS_UNAVAILABLE" });
  });

  it("resolves V3 published versionNumber/contentHash and records immutable acceptance", async () => {
    await expect(db.$transaction(async (tx) => {
      const suffix = randomUUID().slice(0, 8);
      const user = await tx.user.create({
        data: { email: `host-legal-${suffix}@bke.test`, emailVerified: new Date() },
      });
      for (const [type, title] of [
        ["SOFTWARE_LICENSE_AGREEMENT", "Test Software License"],
        ["REFUND_POLICY", "Test Refund Policy"],
      ] as const) {
        const existing = await tx.legalDocument.findFirst({
          where: { documentType: type },
          include: { currentPublishedVersion: true },
        });
        if (existing) {
          expect(existing.status).toBe("ACTIVE");
          expect(existing.currentPublishedVersion?.status).toBe("PUBLISHED");
          continue;
        }
        const markdownContent = `# ${title}\nApplies to {{company_name}}.`;
        const document = await tx.legalDocument.create({
          data: { slug: `host-legal-${type.toLowerCase().replaceAll("_", "-")}-${suffix}`, title, documentType: type, status: "ACTIVE" },
        });
        const version = await tx.legalDocumentVersion.create({
          data: {
            documentId: document.id, versionNumber: 1, markdownContent,
            renderedHtml: renderLegalMarkdown(markdownContent, { company_name: "BKE Digital Solutions" }),
            contentHash: legalRenderedContentSha256(markdownContent, { company_name: "BKE Digital Solutions" }),
            changeSummary: "Disposable PostgreSQL adapter regression",
            status: "PUBLISHED", publishedAt: new Date(), effectiveAt: new Date(),
          },
        });
        await tx.legalDocument.update({
          where: { id: document.id }, data: { currentPublishedVersionId: version.id },
        });
      }
      const requirements = createLegalCheckoutRequirementsCapability(
        createHostLegalCheckoutRequirementsRepository(tx),
      );
      const acceptance = createLegalAcceptanceCapability(createHostLegalAcceptanceRepository(tx));
      const resolved = await requirements.resolve({
        planType: "PERPETUAL",
        variables: { company_name: "BKE Digital Solutions" },
      });
      expect(resolved.status).toBe("RESOLVED");
      if (resolved.status !== "RESOLVED") throw new Error("V3 legal checkout requirements did not resolve");
      expect(resolved.requirements.map(x => x.documentType).sort()).toEqual([
        "REFUND_POLICY", "SOFTWARE_LICENSE_AGREEMENT",
      ]);
      const first = resolved.requirements[0]!;
      expect(first.version).toBe("1");
      expect(first.slaVersion).toBe("1");
      expect(first.publishedContentSha256).toMatch(/^[a-f0-9]{64}$/);
      const request = {
        principalId: user.id, customerAccountId: null,
        documentId: first.documentId, documentVersionId: first.documentVersionId,
        acceptanceContext: "CHECKOUT", slaVersion: first.slaVersion,
        renderedContentSha256: first.renderedContentSha256,
        variablesSnapshot: first.variablesSnapshot,
      } as const;
      const recorded = await acceptance.record(request);
      expect(recorded.status).toBe("RECORDED");
      const duplicate = await acceptance.record(request);
      expect(duplicate.status).toBe("RECORDED");
      expect(await tx.legalAcceptance.count({ where: { userId: user.id } })).toBe(1);
      expect((await acceptance.check(request)).status).toBe("ACCEPTED");
      expect(await acceptance.check({ ...request, renderedContentSha256: "f".repeat(64) }))
        .toEqual({ status: "NOT_ACCEPTED" });
      const mismatched = await acceptance.record({ ...request, slaVersion: "999" });
      expect(mismatched).toEqual({ status: "REJECTED", code: "DOCUMENT_VERSION_MISMATCH" });
      const incomplete = await requirements.resolve({
        planType: "PERPETUAL", selectedVersionIds: [first.documentVersionId],
      });
      expect(incomplete).toEqual({ status: "REJECTED", code: "LEGAL_ACCEPTANCE_REQUIRED" });
      throw rollback;
    })).rejects.toBe(rollback);
  });
});
