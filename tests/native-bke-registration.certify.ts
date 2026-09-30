import assert from "node:assert/strict";

process.env.AGENT_ACCOUNT_SESSION_PEPPER ??=
  "native-registration-cert-agent-session-pepper-5c824be43f3248d08a9fd69e";
process.env.AGENT_ACCOUNT_SESSION_ENCRYPTION_KEY ??=
  "native-registration-cert-agent-session-key-8f37de217ce54a8e9b60c421";

const { db } = await import("@/platform/host/db");
const { hashToken } = await import("@/platform/host/security/crypto");
const {
  NativeCustomerRegistrationError,
  registerNativeCustomer,
  resendNativeCustomerVerification,
  verifyNativeCustomerEmail,
} = await import("@/apps/web/auth/native-customer-registration");

const email = `native-registration-cert-${process.pid}@example.com`;
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

const firstDelivery = await registerNativeCustomer({
  email,
  name,
  password: "NativeCertPassword123",
  legalVersionIds: [termsVersionId, privacyVersionId],
  request,
});

const registered = await db.user.findUniqueOrThrow({
  where: { email },
  include: {
    credential: true,
    ownedAccounts: true,
    legalAcceptances: true,
  },
});
assert.equal(registered.emailVerified, null);
assert.equal(registered.ownedAccounts.length, 1);
assert.equal(registered.ownedAccounts[0]!.type, "INDIVIDUAL");
assert.equal(registered.ownedAccounts[0]!.displayName, name);
assert.equal(registered.legalAcceptances.length, 2);
assert.ok(registered.credential?.passwordHash);
assert.notEqual(
  registered.credential?.passwordHash,
  "NativeCertPassword123",
);

const initialToken = await db.verificationToken.findFirstOrThrow({
  where: {
    identifier: email,
    purpose: "VERIFY_EMAIL_NATIVE",
    usedAt: null,
  },
});
assert.equal(initialToken.tokenHash, hashToken(firstDelivery.code));
assert.notEqual(initialToken.tokenHash, firstDelivery.code);

await db.verificationToken.create({
  data: {
    identifier: email,
    purpose: "VERIFY_EMAIL",
    tokenHash: hashToken(`browser-verification-cert-token-${process.pid}`),
    expiresAt: new Date(Date.now() + 30 * 60_000),
  },
});

const secondDelivery =
  await resendNativeCustomerVerification(email);
assert.ok(secondDelivery);
assert.notEqual(secondDelivery.code, firstDelivery.code);

await assert.rejects(
  () => verifyNativeCustomerEmail(email, firstDelivery.code),
  (error: unknown) =>
    error instanceof NativeCustomerRegistrationError
    && error.code === "INVALID_VERIFICATION_CODE",
);

await verifyNativeCustomerEmail(email, secondDelivery.code);

const verified = await db.user.findUniqueOrThrow({
  where: { email },
});
assert.ok(verified.emailVerified);

const outstanding = await db.verificationToken.count({
  where: {
    identifier: email,
    purpose: { in: ["VERIFY_EMAIL", "VERIFY_EMAIL_NATIVE"] },
    usedAt: null,
  },
});
assert.equal(outstanding, 0);
assert.equal(
  await resendNativeCustomerVerification(email),
  null,
);

await assert.rejects(
  () => registerNativeCustomer({
    email,
    name,
    password: "NativeCertPassword123",
    legalVersionIds: [termsVersionId, privacyVersionId],
    request,
  }),
  (error: unknown) =>
    error instanceof NativeCustomerRegistrationError
    && error.code === "ACCOUNT_EXISTS",
);

console.log("Native customer registration certification: PASS");
await import("./agent-session-account-purchases.certify");
await import("./agent-session-license-seat-management.certify");
