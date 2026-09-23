import "server-only";

import { roleHasAccountsCapability } from "@bke/accounts/logic/account-authorization-policy";
import type { AccountsMemberRole } from "@bke/accounts/contracts/account.contract";
import type { Prisma } from "@/platform/persistence/generated/prisma/client";

export type LicenseSeatAssignmentSnapshot = Readonly<{
  assignmentId: string;
  userId: string;
  email: string;
  name: string | null;
  createdAt: Date;
}>;

export type LicenseSeatSnapshot = Readonly<{
  licenseId: string;
  accountId: string;
  productId: string;
  maxSeats: number;
  assignedSeats: number;
  availableSeats: number;
  assignments: readonly LicenseSeatAssignmentSnapshot[];
}>;

function effectiveRole(
  ownerId: string,
  actorId: string,
  membershipRole?: AccountsMemberRole,
): AccountsMemberRole | undefined {
  return ownerId === actorId ? "OWNER" : membershipRole;
}

async function requireManageableLicense(
  tx: Prisma.TransactionClient,
  actorId: string,
  licenseId: string,
) {
  const license = await tx.license.findUnique({
    where: { id: licenseId },
    include: {
      account: {
        include: {
          memberships: {
            where: { userId: actorId },
            select: { role: true },
            take: 1,
          },
        },
      },
      assignments: {
        include: {
          user: { select: { id: true, email: true, name: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!license) throw new Error("NOT_FOUND");
  if (license.account.lifecycleState !== "ACTIVE") throw new Error("ACCOUNT_NOT_ACTIVE");
  if (license.status !== "ACTIVE") throw new Error("LICENSE_NOT_ACTIVE");

  const role = effectiveRole(
    license.account.ownerId,
    actorId,
    license.account.memberships[0]?.role as AccountsMemberRole | undefined,
  );
  if (!role || !roleHasAccountsCapability(role, "ASSIGN_LICENSE")) {
    throw new Error("ACCOUNT_ROLE_FORBIDDEN");
  }
  return { license, role };
}

function snapshot(license: Awaited<ReturnType<typeof requireManageableLicense>>["license"]): LicenseSeatSnapshot {
  const assignments = license.assignments.map((assignment) => Object.freeze({
    assignmentId: assignment.id,
    userId: assignment.user.id,
    email: assignment.user.email,
    name: assignment.user.name,
    createdAt: assignment.createdAt,
  }));
  return Object.freeze({
    licenseId: license.id,
    accountId: license.accountId,
    productId: license.productId,
    maxSeats: license.maxSeats,
    assignedSeats: assignments.length,
    availableSeats: Math.max(0, license.maxSeats - assignments.length),
    assignments: Object.freeze(assignments),
  });
}

export async function readLicenseSeatState(
  tx: Prisma.TransactionClient,
  input: Readonly<{ actorId: string; licenseId: string }>,
): Promise<LicenseSeatSnapshot> {
  const { license } = await requireManageableLicense(tx, input.actorId, input.licenseId);
  return snapshot(license);
}

export async function assignLicenseSeat(
  tx: Prisma.TransactionClient,
  input: Readonly<{ actorId: string; licenseId: string; targetUserId: string }>,
): Promise<{ status: "ASSIGNED" | "EXISTING"; value: LicenseSeatSnapshot }> {
  const actorId = input.actorId.trim();
  const targetUserId = input.targetUserId.trim();
  if (!actorId || !targetUserId) throw new Error("INVALID_INPUT");

  await tx.$queryRaw`SELECT "id" FROM "License" WHERE "id" = ${input.licenseId} FOR UPDATE`;
  const { license } = await requireManageableLicense(tx, actorId, input.licenseId);

  const target = await tx.user.findFirst({
    where: {
      id: targetUserId,
      lifecycleState: "ACTIVE",
      emailVerified: { not: null },
      OR: [
        { ownedAccounts: { some: { id: license.accountId } } },
        { memberships: { some: { accountId: license.accountId } } },
      ],
    },
    select: { id: true },
  });
  if (!target) throw new Error("TARGET_NOT_ACCOUNT_MEMBER");

  const existing = license.assignments.find((assignment) => assignment.userId === targetUserId);
  if (existing) return { status: "EXISTING", value: snapshot(license) };

  if (license.assignments.length >= license.maxSeats) throw new Error("LICENSE_SEAT_LIMIT");

  await tx.licenseAssignment.create({
    data: { licenseId: license.id, userId: targetUserId },
  });
  await tx.licenseEvent.create({
    data: {
      licenseId: license.id,
      type: "SEAT_ASSIGNED",
      metadata: { userId: targetUserId, actorId },
    },
  });
  await tx.auditLog.create({
    data: {
      actorId,
      accountId: license.accountId,
      action: "LICENSE_SEAT_ASSIGNED",
      targetType: "LicenseAssignment",
      targetId: license.id,
      metadata: { licenseId: license.id, userId: targetUserId },
    },
  });

  const refreshed = await requireManageableLicense(tx, actorId, license.id);
  return { status: "ASSIGNED", value: snapshot(refreshed.license) };
}

export async function removeLicenseSeat(
  tx: Prisma.TransactionClient,
  input: Readonly<{ actorId: string; licenseId: string; targetUserId: string }>,
): Promise<{ status: "REMOVED" | "NOT_ASSIGNED"; value: LicenseSeatSnapshot }> {
  const actorId = input.actorId.trim();
  const targetUserId = input.targetUserId.trim();
  if (!actorId || !targetUserId) throw new Error("INVALID_INPUT");

  await tx.$queryRaw`SELECT "id" FROM "License" WHERE "id" = ${input.licenseId} FOR UPDATE`;
  const { license } = await requireManageableLicense(tx, actorId, input.licenseId);
  const existing = license.assignments.find((assignment) => assignment.userId === targetUserId);
  if (!existing) return { status: "NOT_ASSIGNED", value: snapshot(license) };

  await tx.licenseAssignment.delete({ where: { id: existing.id } });
  await tx.licenseEvent.create({
    data: {
      licenseId: license.id,
      type: "SEAT_REMOVED",
      metadata: { userId: targetUserId, actorId },
    },
  });
  await tx.auditLog.create({
    data: {
      actorId,
      accountId: license.accountId,
      action: "LICENSE_SEAT_REMOVED",
      targetType: "LicenseAssignment",
      targetId: existing.id,
      metadata: { licenseId: license.id, userId: targetUserId },
    },
  });

  const refreshed = await requireManageableLicense(tx, actorId, license.id);
  return { status: "REMOVED", value: snapshot(refreshed.license) };
}

export async function listAssignableLicenseUsers(
  tx: Prisma.TransactionClient,
  input: Readonly<{ actorId: string; licenseId: string }>,
) {
  const { license } = await requireManageableLicense(tx, input.actorId, input.licenseId);
  const account = await tx.customerAccount.findUniqueOrThrow({
    where: { id: license.accountId },
    include: {
      owner: { select: { id: true, email: true, name: true, lifecycleState: true, emailVerified: true } },
      memberships: {
        include: {
          user: { select: { id: true, email: true, name: true, lifecycleState: true, emailVerified: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  const users = [
    account.owner,
    ...account.memberships.map((membership) => membership.user),
  ].filter((user, index, all) =>
    user.lifecycleState === "ACTIVE" &&
    Boolean(user.emailVerified) &&
    all.findIndex((candidate) => candidate.id === user.id) === index
  );

  return Object.freeze(users.map((user) => Object.freeze({
    id: user.id,
    email: user.email,
    name: user.name,
  })));
}
