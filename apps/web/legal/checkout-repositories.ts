import "server-only";

import type { LegalAcceptanceSnapshot, LegalCheckAcceptanceInput, LegalRecordAcceptanceInput } from "@bke/legal/contracts/acceptance.contract";
import type { LegalDocumentType } from "@bke/legal/contracts/checkout-requirements.contract";
import type { LegalAcceptanceRepository } from "@bke/legal/logic/acceptance-repository";
import type { LegalCheckoutRequirementsRepository } from "@bke/legal/logic/checkout-requirements-repository";
import { legalRenderedContentSha256, normalizeLegalVariables } from "@bke/legal/logic/render";
import { db } from "@/platform/host/db";

// Digital Solutions owns the V3 versionNumber/contentHash/userId schema mapping.
// The published @bke/legal package still owns legal validation, hashing and decisions.
type HostLegalClient = Pick<typeof db, "legalDocument" | "legalDocumentVersion" | "legalAcceptance">;

export function createHostLegalCheckoutRequirementsRepository(
  client: HostLegalClient = db,
): LegalCheckoutRequirementsRepository {
  return Object.freeze({
    async findCurrent(documentTypes) {
      const documents = await client.legalDocument.findMany({
        where: {
          status: "ACTIVE",
          documentType: { in: [...documentTypes] },
          currentPublishedVersion: { is: { status: "PUBLISHED" } },
        },
        include: { currentPublishedVersion: true },
      });
      return Object.freeze(documents.map((document) => {
        const version = document.currentPublishedVersion;
        if (!version || version.documentId !== document.id || version.status !== "PUBLISHED") {
          throw new Error("LEGAL_PUBLISHED_VERSION_INVALID");
        }
        return Object.freeze({
          documentId: document.id,
          documentType: document.documentType as LegalDocumentType,
          title: document.title,
          slug: document.slug,
          documentVersionId: version.id,
          version: String(version.versionNumber),
          slaVersion: String(version.versionNumber),
          publishedContentSha256: version.contentHash,
          markdownContent: version.markdownContent,
          requiresReacceptance: version.requiresReacceptance,
        });
      }));
    },
  });
}

type HostAcceptanceRow = {
  id: string;
  userId: string;
  customerAccountId: string | null;
  documentVersionId: string;
  acceptanceContext: string;
  renderedContentHash: string;
  variablesSnapshot: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  acceptedAt: Date;
};

function acceptanceSnapshot(
  row: HostAcceptanceRow,
  documentId: string,
  versionNumber: number,
): LegalAcceptanceSnapshot {
  return Object.freeze({
    acceptanceId: row.id,
    principalId: row.userId,
    customerAccountId: row.customerAccountId,
    documentId,
    documentVersionId: row.documentVersionId,
    acceptanceContext: row.acceptanceContext,
    slaVersion: String(versionNumber),
    renderedContentSha256: row.renderedContentHash,
    variablesSnapshot: row.variablesSnapshot,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    acceptedAt: row.acceptedAt,
  });
}

export function createHostLegalAcceptanceRepository(
  client: HostLegalClient = db,
): LegalAcceptanceRepository {
  return Object.freeze({
    async record(input: LegalRecordAcceptanceInput) {
      const version = await client.legalDocumentVersion.findUnique({
        where: { id: input.documentVersionId },
        include: { document: true },
      });
      if (!version) return { status: "REJECTED", code: "DOCUMENT_VERSION_NOT_FOUND" } as const;
      const variables = normalizeLegalVariables(input.variablesSnapshot);
      if (
        !variables ||
        version.documentId !== input.documentId ||
        version.status !== "PUBLISHED" ||
        version.document.status !== "ACTIVE" ||
        version.document.currentPublishedVersionId !== version.id ||
        String(version.versionNumber) !== input.slaVersion ||
        legalRenderedContentSha256(version.markdownContent, variables) !== input.renderedContentSha256
      ) return { status: "REJECTED", code: "DOCUMENT_VERSION_MISMATCH" } as const;

      const where = {
        userId: input.principalId,
        customerAccountId: input.customerAccountId ?? null,
        documentVersionId: version.id,
        acceptanceContext: input.acceptanceContext,
      };
      await client.legalAcceptance.createMany({
        data: [{
          ...where,
          renderedContentHash: input.renderedContentSha256,
          variablesSnapshot: variables,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
        }],
        skipDuplicates: true,
      });
      const saved = await client.legalAcceptance.findFirst({ where });
      if (!saved || saved.renderedContentHash !== input.renderedContentSha256) {
        return { status: "REJECTED", code: "DOCUMENT_VERSION_MISMATCH" } as const;
      }
      return { status: "RECORDED", value: acceptanceSnapshot(saved, version.documentId, version.versionNumber) } as const;
    },
    async check(input: LegalCheckAcceptanceInput) {
      const version = await client.legalDocumentVersion.findUnique({
        where: { id: input.documentVersionId },
        select: { documentId: true, versionNumber: true },
      });
      if (!version || version.documentId !== input.documentId ||
          String(version.versionNumber) !== input.slaVersion) {
        return { status: "NOT_ACCEPTED" } as const;
      }
      const saved = await client.legalAcceptance.findFirst({
        where: {
          userId: input.principalId,
          customerAccountId: input.customerAccountId ?? null,
          documentVersionId: input.documentVersionId,
          acceptanceContext: input.acceptanceContext,
          renderedContentHash: input.renderedContentSha256,
        },
        orderBy: { acceptedAt: "desc" },
      });
      return saved
        ? { status: "ACCEPTED", value: acceptanceSnapshot(saved, version.documentId, version.versionNumber) } as const
        : { status: "NOT_ACCEPTED" } as const;
    },
  });
}
