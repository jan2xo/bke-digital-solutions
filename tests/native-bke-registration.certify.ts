import assert from "node:assert/strict";

process.env.AGENT_ACCOUNT_SESSION_PEPPER ??=
  "native-registration-cert-agent-session-pepper-5c824be43f3248d08a9fd69e";
process.env.AGENT_ACCOUNT_SESSION_ENCRYPTION_KEY ??=
  "native-registration-cert-agent-session-key-8f37de217ce54a8e9b60c421";

const { db } = await import("@/platform/host/db");
const {
  GoogleRegistrationError,
  registerGoogleCustomer,
} = await import("@/apps/web/auth/google-registration");
const email = `native-registration-cert-${process.pid}@gmail.com`;
const name = "Native Registration Cert";
const request = new Request("https://native-cert.bke.test/native-registration", {
  method: "POST",
  headers: {
    "user-agent": "bke-native-registration-cert",
    "x-forwarded-for": "203.0.113.10",
  },
});

async function resolveLegalVersion(
  documentType: "TERMS_OF_SERVICE" | "PRIVACY_POLICY",
  slug: string,
  title: string,
) {
  const existing = await db.legalDocument.findUnique({
    where: { documentType },
    include: { currentPublishedVersion: true },
  });
  if (existing) {
    assert.equal(existing.status, "ACTIVE");
    assert.ok(existing.currentPublishedVersion);
    assert.equal(existing.currentPublishedVersion.status, "PUBLISHED");
    return existing.currentPublishedVersion.id;
  }

  const document = await db.legalDocument.create({
    data: {
      title,
      slug,
      documentType,
      status: "ACTIVE",
    },
  });
  const version = await db.legalDocumentVersion.create({
    data: {
      documentId: document.id,
      versionNumber: 1,
      markdownContent: `# ${title}\n\nCertification content.`,
      renderedHtml: null,
      status: "PUBLISHED",
      effectiveAt: new Date(),
      publishedAt: new Date(),
      changeSummary: "Native registration certification",
      requiresReacceptance: false,
      contentHash: "0".repeat(64),
    },
  });
  await db.legalDocument.update({
    where: { id: document.id },
    data: { currentPublishedVersionId: version.id },
  });
  return version.id;
}

const termsVersionId = await resolveLegalVersion(
  "TERMS_OF_SERVICE",
  "native-cert-terms",
  "Native Cert Terms",
);
const privacyVersionId = await resolveLegalVersion(
  "PRIVACY_POLICY",
  "native-cert-privacy",
  "Native Cert Privacy",
);

const googleSubject = `native-registration-cert-subject-${process.pid}`;
const firstRegistration = await registerGoogleCustomer({
  subject: googleSubject,
  email,
  emailVerified: true,
  name,
  legalVersionIds: [termsVersionId, privacyVersionId],
  request: new Request("https://jl-bke.com/api/auth/google/callback", {
    headers: { "user-agent": "bke-google-registration-cert" },
  }),
});

const registered = await db.user.findUniqueOrThrow({
  where: { email },
  include: {
    credential: true,
    googleIdentity: true,
    ownedAccounts: true,
    legalAcceptances: true,
  },
});
assert.equal(registered.role, "CUSTOMER");
assert.ok(registered.emailVerified);
assert.equal(registered.ownedAccounts.length, 1);
assert.equal(registered.ownedAccounts[0]!.type, "INDIVIDUAL");
assert.equal(registered.ownedAccounts[0]!.displayName, name);
assert.equal(registered.legalAcceptances.length, 2);
assert.equal(registered.credential, null);
assert.equal(registered.googleIdentity?.subject, googleSubject);

const outstanding = await db.verificationToken.count({ where: { identifier: email } });
assert.equal(outstanding, 0);
assert.equal(firstRegistration.user.id, registered.id);

await assert.rejects(
  () => registerGoogleCustomer({
    subject: `different-subject-${process.pid}`,
    email,
    emailVerified: true,
    name,
    legalVersionIds: [termsVersionId, privacyVersionId],
    request,
  }),
  (error: unknown) =>
    error instanceof GoogleRegistrationError
    && error.code === "ACCOUNT_EXISTS",
);

console.log("Google customer registration without native email verification certification: PASS");
await import("./agent-session-account-purchases.certify");
await import("./agent-session-license-seat-management.certify");
await import("./agent-session-license-device-management.certify");
