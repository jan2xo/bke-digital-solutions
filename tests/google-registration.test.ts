import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { db } from "../platform/host/db";
import { hashToken } from "../platform/host/security/crypto";
import { registerGoogleCustomer } from "../apps/web/auth/google-registration";

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const userIds: string[] = [];
const emails: string[] = [];

async function legalVersionIds(): Promise<string[]> {
  const documents = await db.legalDocument.findMany({
    where: {
      status: "ACTIVE",
      documentType: { in: ["TERMS_OF_SERVICE", "PRIVACY_POLICY"] },
      currentPublishedVersionId: { not: null },
    },
    select: { currentPublishedVersionId: true },
  });
  const ids = documents.map((document) => document.currentPublishedVersionId!).sort();
  if (ids.length !== 2) throw new Error("CI seed must provide current terms and privacy versions.");
  return ids;
}

async function registrationInput(subject: string, email = `google-register-${randomUUID()}@example.test`) {
  emails.push(email);
  return {
    subject,
    email,
    emailVerified: true,
    name: "Google Registration Test",
    legalVersionIds: await legalVersionIds(),
    request: new Request("https://jl-bke.com/api/auth/google/callback", {
      headers: { "user-agent": "Google registration integration test" },
    }),
  };
}

suite("Google registration PostgreSQL transaction", () => {
  afterEach(async () => {
    if (userIds.length === 0 && emails.length === 0) return;
    const ids = [...userIds];
    const identifiers = [...emails];
    userIds.length = 0;
    emails.length = 0;
    await db.$transaction(async (tx) => {
      if (ids.length) {
        await tx.googleIdentity.deleteMany({ where: { userId: { in: ids } } });
        await tx.session.deleteMany({ where: { userId: { in: ids } } });
        await tx.customerAccount.deleteMany({ where: { ownerId: { in: ids } } });
        await tx.user.deleteMany({ where: { id: { in: ids } } });
      }
      if (identifiers.length) {
        await tx.verificationToken.deleteMany({ where: { identifier: { in: identifiers } } });
      }
    });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("commits the customer, owned account, legal records, verification token, and stable Google subject together", async () => {
    const input = await registrationInput(`subject-${randomUUID()}`);
    const result = await registerGoogleCustomer(input);
    // Successful registrations own immutable LegalAcceptance rows. Keep these
    // unique fixture principals in the disposable CI database until teardown.

    const user = await db.user.findUniqueOrThrow({
      where: { id: result.user.id },
      include: {
        ownedAccounts: true,
        legalAcceptances: true,
        googleIdentity: true,
        credential: true,
      },
    });
    const token = await db.verificationToken.findFirstOrThrow({
      where: { identifier: input.email },
    });

    expect(user.role).toBe("CUSTOMER");
    expect(user.emailVerified).toBeNull();
    expect(user.ownedAccounts).toHaveLength(1);
    expect(user.legalAcceptances).toHaveLength(2);
    expect(user.googleIdentity?.subject).toBe(input.subject);
    expect(user.credential).toBeNull();
    expect(token.tokenHash).toBe(hashToken(result.verificationToken));
  });

  it("does not email-link an existing BKE user or mutate its identity", async () => {
    const email = `existing-${randomUUID()}@example.test`;
    emails.push(email);
    const existing = await db.user.create({
      data: { email, emailVerified: null },
      select: { id: true },
    });
    userIds.push(existing.id);

    await expect(
      registerGoogleCustomer(await registrationInput(`subject-${randomUUID()}`, email)),
    ).rejects.toMatchObject({ code: "ACCOUNT_EXISTS" });

    const unchanged = await db.user.findUniqueOrThrow({
      where: { id: existing.id },
      include: { googleIdentity: true },
    });
    expect(unchanged.emailVerified).toBeNull();
    expect(unchanged.googleIdentity).toBeNull();
  });

  it("rolls back registration when a stable Google subject is already bound", async () => {
    const subject = `subject-${randomUUID()}`;
    const ownerEmail = `owner-${randomUUID()}@example.test`;
    emails.push(ownerEmail);
    const owner = await db.user.create({
      data: {
        email: ownerEmail,
        googleIdentity: { create: { subject } },
      },
      select: { id: true },
    });
    userIds.push(owner.id);
    const input = await registrationInput(subject);

    await expect(registerGoogleCustomer(input)).rejects.toMatchObject({
      code: "GOOGLE_SUBJECT_ALREADY_BOUND",
    });
    expect(await db.user.findUnique({ where: { email: input.email } })).toBeNull();
    expect(await db.googleIdentity.count({ where: { subject } })).toBe(1);
  });

  it("allows only one concurrent registration for a Google subject and leaves no orphan user", async () => {
    const subject = `subject-${randomUUID()}`;
    const [first, second] = await Promise.all([
      registrationInput(subject),
      registrationInput(subject),
    ]);
    const results = await Promise.allSettled([
      registerGoogleCustomer(first),
      registerGoogleCustomer(second),
    ]);
    for (const result of results) {
      // The winning registration owns immutable legal acceptance rows; leave it
      // in the disposable CI database until teardown.
    }

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await db.googleIdentity.count({ where: { subject } })).toBe(1);
    expect(await db.user.count({
      where: { email: { in: [first.email, second.email] } },
    })).toBe(1);
  });
});
