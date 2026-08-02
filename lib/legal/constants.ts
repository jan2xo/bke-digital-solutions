export const LEGAL_DOCUMENT_TYPES = [
  "TERMS_OF_SERVICE",
  "PRIVACY_POLICY",
  "SOFTWARE_LICENSE_AGREEMENT",
  "SUBSCRIPTION_TERMS",
  "REFUND_POLICY",
  "ACCEPTABLE_USE_POLICY",
  "COOKIE_POLICY",
  "SUPPORT_POLICY",
  "DATA_PROCESSING_ADDENDUM",
] as const;

export type LegalDocumentType = typeof LEGAL_DOCUMENT_TYPES[number];

export const LEGAL_DOCUMENT_DEFINITIONS: Record<LegalDocumentType, { title: string; slug: string }> = {
  TERMS_OF_SERVICE: { title: "Terms of Service", slug: "terms" },
  PRIVACY_POLICY: { title: "Privacy Policy", slug: "privacy" },
  SOFTWARE_LICENSE_AGREEMENT: { title: "Software License Agreement (EULA)", slug: "eula" },
  SUBSCRIPTION_TERMS: { title: "Subscription Terms", slug: "subscription" },
  REFUND_POLICY: { title: "Refund Policy", slug: "refund" },
  ACCEPTABLE_USE_POLICY: { title: "Acceptable Use Policy", slug: "acceptable-use" },
  COOKIE_POLICY: { title: "Cookie Policy", slug: "cookies" },
  SUPPORT_POLICY: { title: "Support Policy", slug: "support" },
  DATA_PROCESSING_ADDENDUM: { title: "Data Processing Addendum", slug: "dpa" },
};

export const REGISTRATION_LEGAL_TYPES: LegalDocumentType[] = ["TERMS_OF_SERVICE", "PRIVACY_POLICY"];
export const CHECKOUT_LEGAL_TYPES: LegalDocumentType[] = ["SOFTWARE_LICENSE_AGREEMENT", "REFUND_POLICY"];
export const SUBSCRIPTION_LEGAL_TYPES: LegalDocumentType[] = ["SUBSCRIPTION_TERMS"];

