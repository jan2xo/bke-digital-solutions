import "server-only";

import { createHash } from "node:crypto";
import {
  applyLegalVariables as applyPackageLegalVariables,
  renderLegalMarkdown as renderPackageLegalMarkdown,
  type LegalRenderVariables,
} from "@bke/legal/logic/render";
import { getLegalPresentationEnvironment } from "@/v2/apps/web/config/environment";

export type LegalVariables = Record<
  "company_name" | "support_email" | "website" | "business_address",
  string
>;

export function legalVariables(): LegalVariables {
  const environment = getLegalPresentationEnvironment();
  return {
    company_name: "BKE Digital Solutions",
    support_email: environment.supportEmail,
    website: environment.appUrl,
    business_address: environment.businessAddress,
  };
}

export function applyLegalVariables(markdown: string, variables: LegalVariables) {
  return applyPackageLegalVariables(markdown, variables satisfies LegalRenderVariables);
}

export function renderLegalMarkdown(markdown: string, variables: LegalVariables = legalVariables()) {
  return renderPackageLegalMarkdown(markdown, variables);
}

export const legalContentHash = (html: string) =>
  createHash("sha256").update(html).digest("hex");
