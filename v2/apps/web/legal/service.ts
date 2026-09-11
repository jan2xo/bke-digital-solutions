import "server-only";
import type { LegalDocumentType } from "@bke/legal/contracts/checkout-requirements.contract";
import { db } from "@/lib/db";
import { clientIp } from "@/v2/apps/web/http/request";
import { legalContentHash, legalVariables, renderLegalMarkdown } from "@/v2/apps/web/legal/render";

const REGISTRATION_LEGAL_TYPES: LegalDocumentType[] = ["TERMS_OF_SERVICE", "PRIVACY_POLICY"];
const CHECKOUT_LEGAL_TYPES: LegalDocumentType[] = ["SOFTWARE_LICENSE_AGREEMENT", "REFUND_POLICY"];
const SUBSCRIPTION_LEGAL_TYPES: LegalDocumentType[] = ["SUBSCRIPTION_TERMS"];

type LegalClient = Pick<typeof db, "legalDocument" | "legalAcceptance">;

export async function publishedLegalDocuments(types?: LegalDocumentType[]) {
  return db.legalDocument.findMany({
    where: { status: "ACTIVE", ...(types ? { documentType: { in: types } } : {}), currentPublishedVersionId: { not: null } },
    include: { currentPublishedVersion: true },
    orderBy: { title: "asc" },
  });
}

export function checkoutLegalTypes(planType: "PERPETUAL" | "MONTHLY" | "ANNUAL") {
  return [...CHECKOUT_LEGAL_TYPES, ...(planType === "PERPETUAL" ? [] : SUBSCRIPTION_LEGAL_TYPES)];
}

async function requiredVersions(client: LegalClient, types: LegalDocumentType[]) {
  const documents = await client.legalDocument.findMany({
    where: { status: "ACTIVE", documentType: { in: types }, currentPublishedVersionId: { not: null } },
    include: { currentPublishedVersion: true },
  });
  if (documents.length !== types.length || documents.some((item) => !item.currentPublishedVersion || item.currentPublishedVersion.status !== "PUBLISHED")) throw new Error("LEGAL_DOCUMENTS_UNAVAILABLE");
  return documents;
}

export async function validateLegalVersionSelection(client: LegalClient, types: LegalDocumentType[], selectedVersionIds: string[]) {
  const documents = await requiredVersions(client, types);
  const expected = documents.map((item) => item.currentPublishedVersionId!);
  if (selectedVersionIds.length !== expected.length || expected.some((id) => !selectedVersionIds.includes(id))) throw new Error("LEGAL_ACCEPTANCE_REQUIRED");
  return documents;
}

export async function recordLegalAcceptances(client: LegalClient, input: { userId: string; customerAccountId?: string; types: LegalDocumentType[]; selectedVersionIds: string[]; context: string; request: Request }) {
  const documents = await validateLegalVersionSelection(client, input.types, input.selectedVersionIds);
  const variables = legalVariables();
  const ipAddress = clientIp(input.request).slice(0, 128);
  const userAgent = input.request.headers.get("user-agent")?.slice(0, 500) ?? null;
  await client.legalAcceptance.createMany({ data: documents.map((document) => {
    const version = document.currentPublishedVersion!;
    const rendered = renderLegalMarkdown(version.markdownContent, variables);
    return { userId: input.userId, customerAccountId: input.customerAccountId, documentVersionId: version.id, acceptanceContext: input.context, ipAddress, userAgent, renderedContentHash: legalContentHash(rendered), variablesSnapshot: variables };
  }), skipDuplicates: true });
}

export async function pendingReacceptance(userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { createdAt: true } });
  if (!user) return [];
  return db.legalDocument.findMany({
    where: { status: "ACTIVE", currentPublishedVersion: { is: { status: "PUBLISHED", requiresReacceptance: true, updatedAt: { gt: user.createdAt }, acceptances: { none: { userId } } } } },
    include: { currentPublishedVersion: true },
    orderBy: { title: "asc" },
  });
}

export async function assertLegalAcceptanceCurrent(userId: string) {
  if ((await pendingReacceptance(userId)).length > 0) throw new Error("LEGAL_REACCEPTANCE_REQUIRED");
}

export async function registrationLegalDocuments() { return publishedLegalDocuments(REGISTRATION_LEGAL_TYPES); }
