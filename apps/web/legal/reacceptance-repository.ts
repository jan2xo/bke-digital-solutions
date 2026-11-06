import "server-only";

import type { LegalReacceptanceStatusInput } from "@bke/legal/contracts/reacceptance-status.contract";
import type { LegalDocumentType } from "@bke/legal/contracts/checkout-requirements.contract";
import type { LegalReacceptanceStatusRepository } from "@bke/legal/logic/reacceptance-status-repository";
import { db } from "@/platform/host/db";

// Digital Solutions owns the legacy User/versionNumber storage mapping.
// The released Legal capability continues to own validation and the decision.
export function createHostLegalReacceptanceStatusRepository(): LegalReacceptanceStatusRepository {
  return Object.freeze({
    async findPending(input: LegalReacceptanceStatusInput) {
      const documents = await db.legalDocument.findMany({
        where: {
          status: "ACTIVE",
          currentPublishedVersion: {
            is: {
              status: "PUBLISHED",
              requiresReacceptance: true,
              updatedAt: { gt: input.principalEstablishedAt },
              acceptances: { none: { userId: input.principalId } },
            },
          },
        },
        include: { currentPublishedVersion: true },
        orderBy: { title: "asc" },
      });

      return Object.freeze(documents.map((document) => {
        const version = document.currentPublishedVersion;
        if (!version || version.documentId !== document.id || !version.publishedAt) {
          throw new Error("LEGAL_PUBLISHED_VERSION_INVALID");
        }
        return Object.freeze({
          documentId: document.id,
          documentType: document.documentType as LegalDocumentType,
          title: document.title,
          slug: document.slug,
          documentVersionId: version.id,
          version: String(version.versionNumber),
          publishedAt: version.publishedAt,
        });
      }));
    },
  });
}
