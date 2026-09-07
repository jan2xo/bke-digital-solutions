import "server-only";

import { createHash } from "node:crypto";
import {
  applyLegalVariables as applyPackageLegalVariables,
  renderLegalMarkdown as renderPackageLegalMarkdown,
  type LegalRenderVariables,
} from "@bke/legal/logic/render";
import { env } from "@/lib/env";

export type LegalVariables = Record<
  "company_name" | "support_email" | "website" | "business_address",
  string
>;

export function legalVariables(): LegalVariables {
  return {
    company_name: "BKE Digital Solutions",
    support_email: env.SUPPORT_EMAIL,
    website: env.APP_URL,
    business_address: env.BUSINESS_ADDRESS,
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
