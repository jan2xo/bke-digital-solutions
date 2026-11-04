import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../platform/persistence/generated/prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { bootstrapGoogleAdministrator } from "../scripts/google-admin-bootstrap";

const databaseUrl = process.env.DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const database = databaseUrl
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) })
  : null;
const createdUserIds: string[] = [];

async function createPrincipal(input: {
  role?: "CUSTOMER" | "ADMIN";
  googleBound?: boolean;
  emailVerified?: boolean;
  suspended?: boolean;
}) {
  if (!database) throw new Error("DATABASE_URL is required for this test.");
  const suffix = randomUUID();
  const user = await database.user.create({
    data: {
      email: `google-admin-${suffix}@example.test`,
      role: input.role ?? "CUSTOMER",
      emailVerified: input.emailVerified === false ? null : new Date(),
      suspendedAt: input.suspended ? new Date() : null,
      lifecycleState: input.suspended ? "SUSPENDED" : "ACTIVE",
      ...(input.googleBound === false
        ? {}
        : { googleIdentity: { create: { subject: `google-subject-${suffix}` } } }),
    },
    select: { id: true },
  });
  createdUserIds.push(user.id);
  return user.id;
}

suite("Google administrator bootstrap persistence", () => {
  afterEach(async () => {
    if (!database || createdUserIds.length === 0) return;
    const ids = [...createdUserIds];
    createdUserIds.length = 0;
    await database.$transaction(async (tx) => {
      await tx.auditLog.deleteMany({ where: { targetId: { in: ids } } });
      await tx.session.deleteMany({ where: { userId: { in: ids } } });
      await tx.googleIdentity.deleteMany({ where: { userId: { in: ids } } });
      await tx.user.deleteMany({ where: { id: { in: ids } } });
    });
  });

  afterAll(async () => {
    await database?.$disconnect();
  });

  it("promotes only the selected bound principal, revokes existing sessions, and audits the operator action", async () => {
    if (!database) throw new Error("DATABASE_URL is required for this test.");
    const existingAdminId = await createPrincipal({ role: "ADMIN" });
    const targetId = await createPrincipal({});
    const emailVerifiedBefore = (await database.user.findUniqueOrThrow({
      where: { id: targetId },
      select: { emailVerified: true },
    })).emailVerified;
    const now = new Date();
    const session = await database.session.create({
      data: {
        userId: targetId,
        tokenHash: `bootstrap-test-${randomUUID()}`,
        expiresAt: new Date(now.getTime() + 60 * 60_000),
        absoluteExpiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
        authenticationMethod: "GOOGLE_OIDC",
      },
      select: { id: true },
    });

    await expect(
      bootstrapGoogleAdministrator(database, {
        userId: targetId,
        reason: "authorized test promotion",
        operatorId: "ci-test-operator",
        deploymentEnvironment: "test",
        allowAdditionalAdministrator: false,
      }),
    ).rejects.toThrow("Another administrator exists");

    expect((await database.user.findUniqueOrThrow({
      where: { id: targetId },
      select: { role: true },
    })).role).toBe("CUSTOMER");

    const result = await bootstrapGoogleAdministrator(database, {
      userId: targetId,
      reason: "authorized test promotion",
      operatorId: "ci-test-operator",
      deploymentEnvironment: "test",
      allowAdditionalAdministrator: true,
    });

    const promoted = await database.user.findUniqueOrThrow({
      where: { id: targetId },
      select: {
        role: true,
        emailVerified: true,
        googleIdentity: { select: { subject: true } },
        credential: { select: { userId: true } },
      },
    });
    const revokedSession = await database.session.findUniqueOrThrow({
      where: { id: session.id },
      select: { revokedAt: true, revocationReason: true },
    });
    const audit = await database.auditLog.findFirstOrThrow({
      where: { targetId, action: "ADMIN_GOOGLE_BOOTSTRAP" },
      orderBy: { createdAt: "desc" },
      select: { metadata: true },
    });

    expect(result).toEqual({ userId: targetId, revokedSessions: 1 });
    expect(promoted.role).toBe("ADMIN");
    expect(promoted.emailVerified).toEqual(emailVerifiedBefore);
    expect(promoted.googleIdentity?.subject).toContain("google-subject-");
    expect(promoted.credential).toBeNull();
    expect(revokedSession.revokedAt).not.toBeNull();
    expect(revokedSession.revocationReason).toBe("ADMIN_GOOGLE_BOOTSTRAP");
    expect(audit.metadata).toMatchObject({
      operatorId: "ci-test-operator",
      mfaEnrollmentRequired: true,
    });
    expect(existingAdminId).not.toBe(targetId);
  });

  it.each([
    { googleBound: false, emailVerified: true, suspended: false, label: "unbound user" },
    { googleBound: true, emailVerified: false, suspended: false, label: "unverified BKE contact" },
    { googleBound: true, emailVerified: true, suspended: true, label: "inactive user" },
  ])("rejects $label", async ({ googleBound, emailVerified, suspended }) => {
    if (!database) throw new Error("DATABASE_URL is required for this test.");
    const userId = await createPrincipal({ googleBound, emailVerified, suspended });
    await expect(
      bootstrapGoogleAdministrator(database, {
        userId,
        reason: "authorized test promotion",
        operatorId: "ci-test-operator",
        deploymentEnvironment: "test",
        allowAdditionalAdministrator: true,
      }),
    ).rejects.toThrow("active Google-bound user");
  });
});
