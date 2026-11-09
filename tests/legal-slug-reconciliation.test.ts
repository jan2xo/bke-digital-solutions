import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEGAL_DOCUMENT_DEFINITIONS, LEGAL_DOCUMENT_TYPES } from "../lib/legal/constants";

// Snapshot of Neon LegalDocument records verified on 2026-11-09.
// Public navigation must use live persisted slugs, not this snapshot.
const neonSlugs = {
  TERMS_OF_SERVICE: "terms-of-service",
  PRIVACY_POLICY: "privacy-policy",
  SOFTWARE_LICENSE_AGREEMENT: "software-license-agreement",
  SUBSCRIPTION_TERMS: "subscription-terms",
  REFUND_POLICY: "refund-policy",
  ACCEPTABLE_USE_POLICY: "acceptable-use-policy",
  COOKIE_POLICY: "cookie-policy",
  SUPPORT_POLICY: "support-policy",
  DATA_PROCESSING_ADDENDUM: "data-processing-addendum",
} as const;

describe("legal slug reconciliation", () => {
  it("aligns fallback definitions with the existing Neon legal catalog", () => {
    expect(LEGAL_DOCUMENT_TYPES).toEqual(Object.keys(neonSlugs));
    for (const documentType of LEGAL_DOCUMENT_TYPES) {
      expect(LEGAL_DOCUMENT_DEFINITIONS[documentType].slug).toBe(neonSlugs[documentType]);
    }
  });

  it("resolves public footer links from persisted published slugs", () => {
    const footer = readFileSync("components/footer.tsx", "utf8");
    expect(footer).toContain("publishedLegalDocuments(");
    expect(footer).toContain('document.currentPublishedVersion?.status === "PUBLISHED"');
    expect(footer).toContain("slugsByType.get(type)");
    expect(footer).toContain('href={`/legal/${slug}`}');
    expect(footer).not.toMatch(/href="\/legal\/(terms|privacy|eula|refund|cookies)"/);
  });

  it("uses the same canonical definitions in the disposable seed", () => {
    const seed = readFileSync("prisma/seed.ts", "utf8");
    expect(seed).toContain('import { LEGAL_DOCUMENT_DEFINITIONS, LEGAL_DOCUMENT_TYPES }');
    expect(seed).toContain("LEGAL_DOCUMENT_TYPES.map((documentType)");
    expect(seed).toContain("LEGAL_DOCUMENT_DEFINITIONS[documentType].slug");
  });
});
