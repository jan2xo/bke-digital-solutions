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
  TERMS_OF_SERVICE: { title: "Terms of Service", slug: "terms-of-service" },
  PRIVACY_POLICY: { title: "Privacy Policy", slug: "privacy-policy" },
  SOFTWARE_LICENSE_AGREEMENT: { title: "Software License Agreement (EULA)", slug: "software-license-agreement" },
  SUBSCRIPTION_TERMS: { title: "Subscription Terms", slug: "subscription-terms" },
  REFUND_POLICY: { title: "Refund Policy", slug: "refund-policy" },
  ACCEPTABLE_USE_POLICY: { title: "Acceptable Use Policy", slug: "acceptable-use-policy" },
  COOKIE_POLICY: { title: "Cookie Policy", slug: "cookie-policy" },
  SUPPORT_POLICY: { title: "Support Policy", slug: "support-policy" },
  DATA_PROCESSING_ADDENDUM: { title: "Data Processing Addendum", slug: "data-processing-addendum" },
};

export const REGISTRATION_LEGAL_TYPES: LegalDocumentType[] = ["TERMS_OF_SERVICE", "PRIVACY_POLICY"];
export const CHECKOUT_LEGAL_TYPES: LegalDocumentType[] = ["SOFTWARE_LICENSE_AGREEMENT", "REFUND_POLICY"];
export const SUBSCRIPTION_LEGAL_TYPES: LegalDocumentType[] = ["SUBSCRIPTION_TERMS"];

