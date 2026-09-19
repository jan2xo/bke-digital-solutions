import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@/platform/persistence/generated/prisma/client";
import { requireAgentDeviceAccountAccessInTransaction } from "@/apps/web/accounts/agent-device-session-authorization";
import {
  decryptAgentTokenBundle,
  encryptAgentTokenBundle,
  generateAgentDeviceCode,
  generateAgentSessionToken,
  generateAgentUserCode,
  hashAgentAccessToken,
  hashAgentDeviceCode,
  hashAgentRefreshToken,
  hashAgentUserCode,
  type AgentAccountTokenBundle,
} from "./material";

const AUTHORIZATION_TTL_MS = 10 * 60 * 1000;
const HANDOFF_TTL_MS = 5 * 60 * 1000;
const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const POLL_INTERVAL_SECONDS = 5;

type DeviceAuthorizationRow = Readonly<{
  id: string;
  deviceId: string;
  status: "PENDING" | "APPROVED" | "DENIED" | "EXPIRED" | "CONSUMED";
  expiresAt: Date;
  pollIntervalSeconds: number;
  approvedByUserId: string | null;
  approvedAccountId: string | null;
  approvedAt: Date | null;
  handoffExpiresAt: Date | null;
  sessionId: string | null;
  tokenBundleCiphertext: string | null;
}>;

function validDeviceId(value: string): boolean {
  return /^[A-Za-z0-9._:-]{16,256}$/.test(value);
}

function validPlatform(value: string): boolean {
  return value === "windows" || value === "macos" || value === "linux";
}

function validArchitecture(value: string): boolean {
  return value === "x64" || value === "arm64" || value === "x86";
}

export async function startAgentDeviceAuthorization(
  tx: Prisma.TransactionClient,
  input: Readonly<{
    deviceId: string;
    deviceName?: string | null;
    platform: string;
    architecture: string;
    verificationBaseUrl: string;
    pepper: string;
  }>,
) {
  const deviceId = input.deviceId.trim();
  const deviceName = input.deviceName?.trim() || null;
  const platform = input.platform.trim().toLowerCase();
  const architecture = input.architecture.trim().toLowerCase();
  if (
    !validDeviceId(deviceId) ||
    (deviceName !== null && deviceName.length > 128) ||
    !validPlatform(platform) ||
    !validArchitecture(architecture)
  ) {
    throw new Error("INVALID_AGENT_DEVICE");
  }

  const now = new Date();
  await tx.$executeRaw`
    UPDATE "AgentDeviceAuthorization"
       SET "status" = 'EXPIRED', "updatedAt" = NOW()
     WHERE "deviceId" = ${deviceId}
       AND "status" = 'PENDING'
  `;

  const id = randomUUID();
  const deviceCode = generateAgentDeviceCode();
  const userCode = generateAgentUserCode();
  const expiresAt = new Date(now.getTime() + AUTHORIZATION_TTL_MS);
  const deviceCodeHash = hashAgentDeviceCode(deviceCode, input.pepper);
  const userCodeHash = hashAgentUserCode(userCode, input.pepper);

  await tx.$executeRaw`
    INSERT INTO "AgentDeviceAuthorization" (
      "id", "deviceCodeHash", "userCodeHash", "deviceId", "deviceName",
      "platform", "architecture", "status", "expiresAt", "pollIntervalSeconds",
      "createdAt", "updatedAt"
    ) VALUES (
      ${id}, ${deviceCodeHash}, ${userCodeHash}, ${deviceId}, ${deviceName},
      ${platform}, ${architecture}, 'PENDING', ${expiresAt}, ${POLL_INTERVAL_SECONDS},
      NOW(), NOW()
    )
  `;

  const verification = new URL("/device", input.verificationBaseUrl);
  verification.searchParams.set("code", userCode);

  return Object.freeze({
    deviceCode,
    userCode,
    verificationUri: verification.toString(),
    expiresIn: Math.floor(AUTHORIZATION_TTL_MS / 1000),
    interval: POLL_INTERVAL_SECONDS,
  });
}

export async function approveAgentDeviceAuthorization(
  tx: Prisma.TransactionClient,
  input: Readonly<{
    userCode: string;
    principalId: string;
    accountId: string;
    pepper: string;
  }>,
) {
  const userCodeHash = hashAgentUserCode(input.userCode, input.pepper);
  const rows = await tx.$queryRaw<DeviceAuthorizationRow[]>`
    SELECT "id", "deviceId", "status", "expiresAt", "pollIntervalSeconds",
           "approvedByUserId", "approvedAccountId", "approvedAt",
           "handoffExpiresAt", "sessionId", "tokenBundleCiphertext"
      FROM "AgentDeviceAuthorization"
     WHERE "userCodeHash" = ${userCodeHash}
     FOR UPDATE
  `;
  const authorization = rows[0];
  if (!authorization) return { status: "NOT_FOUND" as const };

  const now = new Date();
  if (
    authorization.status === "EXPIRED" ||
    (authorization.status === "PENDING" && authorization.expiresAt <= now)
  ) {
    await tx.$executeRaw`
      UPDATE "AgentDeviceAuthorization"
         SET "status" = 'EXPIRED', "updatedAt" = NOW()
       WHERE "id" = ${authorization.id}
    `;
    return { status: "EXPIRED" as const };
  }

  if (authorization.status !== "PENDING") {
    return { status: authorization.status as "APPROVED" | "DENIED" | "CONSUMED" };
  }

  const account = await requireAgentDeviceAccountAccessInTransaction(
    tx,
    input.principalId,
    input.accountId,
  );

  await tx.$executeRaw`
    UPDATE "AgentDeviceAuthorization"
       SET "status" = 'APPROVED',
           "approvedByUserId" = ${input.principalId},
           "approvedAccountId" = ${account.id},
           "approvedAt" = NOW(),
           "updatedAt" = NOW()
     WHERE "id" = ${authorization.id}
       AND "status" = 'PENDING'
  `;

  await tx.auditLog.create({
    data: {
      actorId: input.principalId,
      accountId: account.id,
      action: "AGENT_DEVICE_AUTHORIZATION_APPROVED",
      targetType: "AgentDeviceAuthorization",
      targetId: authorization.id,
      metadata: {
        deviceId: authorization.deviceId,
        accountRole: account.effectiveRole,
      },
    },
  });

  return Object.freeze({
    status: "APPROVED" as const,
    deviceId: authorization.deviceId,
    account,
  });
}

export async function pollAgentDeviceAuthorization(
  tx: Prisma.TransactionClient,
  input: Readonly<{
    deviceCode: string;
    pepper: string;
    encryptionKey: string;
  }>,
): Promise<
  | { readonly status: "authorization_pending" | "access_denied" | "expired_token" }
  | ({ readonly status: "approved" } & AgentAccountTokenBundle)
> {
  const deviceCodeHash = hashAgentDeviceCode(input.deviceCode, input.pepper);
  const rows = await tx.$queryRaw<DeviceAuthorizationRow[]>`
    SELECT "id", "deviceId", "status", "expiresAt", "pollIntervalSeconds",
           "approvedByUserId", "approvedAccountId", "approvedAt",
           "handoffExpiresAt", "sessionId", "tokenBundleCiphertext"
      FROM "AgentDeviceAuthorization"
     WHERE "deviceCodeHash" = ${deviceCodeHash}
     FOR UPDATE
  `;
  const authorization = rows[0];
  if (!authorization) return { status: "expired_token" };

  const now = new Date();

  if (authorization.status === "PENDING") {
    if (authorization.expiresAt <= now) {
      await tx.$executeRaw`
        UPDATE "AgentDeviceAuthorization"
           SET "status" = 'EXPIRED', "updatedAt" = NOW()
         WHERE "id" = ${authorization.id}
      `;
      return { status: "expired_token" };
    }
    return { status: "authorization_pending" };
  }

  if (authorization.status === "DENIED") return { status: "access_denied" };
  if (authorization.status === "EXPIRED") return { status: "expired_token" };

  if (authorization.status === "CONSUMED") {
    if (
      !authorization.handoffExpiresAt ||
      authorization.handoffExpiresAt <= now ||
      !authorization.tokenBundleCiphertext
    ) {
      if (authorization.tokenBundleCiphertext) {
        await tx.$executeRaw`
          UPDATE "AgentDeviceAuthorization"
             SET "tokenBundleCiphertext" = NULL, "updatedAt" = NOW()
           WHERE "id" = ${authorization.id}
        `;
      }
      return { status: "expired_token" };
    }

    const bundle = decryptAgentTokenBundle(
      authorization.tokenBundleCiphertext,
      input.encryptionKey,
    );
    return Object.freeze({ status: "approved" as const, ...bundle });
  }

  if (
    authorization.status !== "APPROVED" ||
    !authorization.approvedByUserId ||
    !authorization.approvedAccountId
  ) {
    return { status: "access_denied" };
  }

  let account;
  try {
    account = await requireAgentDeviceAccountAccessInTransaction(
      tx,
      authorization.approvedByUserId,
      authorization.approvedAccountId,
    );
  } catch {
    await tx.$executeRaw`
      UPDATE "AgentDeviceAuthorization"
         SET "status" = 'DENIED', "deniedAt" = NOW(), "updatedAt" = NOW()
       WHERE "id" = ${authorization.id}
    `;
    return { status: "access_denied" };
  }

  const user = await tx.user.findUnique({
    where: { id: authorization.approvedByUserId },
    select: { id: true, email: true, emailVerified: true, lifecycleState: true },
  });
  if (
    !user ||
    !user.emailVerified ||
    user.lifecycleState !== "ACTIVE"
  ) {
    await tx.$executeRaw`
      UPDATE "AgentDeviceAuthorization"
         SET "status" = 'DENIED', "deniedAt" = NOW(), "updatedAt" = NOW()
       WHERE "id" = ${authorization.id}
    `;
    return { status: "access_denied" };
  }

  const sessionId = randomUUID();
  const accessToken = generateAgentSessionToken();
  const refreshToken = generateAgentSessionToken();
  const accessExpiresAt = new Date(now.getTime() + ACCESS_TOKEN_TTL_MS);
  const refreshExpiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);
  const handoffExpiresAt = new Date(now.getTime() + HANDOFF_TTL_MS);

  const bundle: AgentAccountTokenBundle = Object.freeze({
    sessionId,
    accessToken,
    refreshToken,
    accessExpiresAt: accessExpiresAt.toISOString(),
    refreshExpiresAt: refreshExpiresAt.toISOString(),
    userId: user.id,
    email: user.email,
    accountId: account.id,
    accountType: account.type,
    accountDisplayName: account.displayName,
  });
  const tokenBundleCiphertext = encryptAgentTokenBundle(
    bundle,
    input.encryptionKey,
  );

  await tx.$executeRaw`
    INSERT INTO "AgentAccountSession" (
      "id", "deviceAuthorizationId", "userId", "accountId", "deviceId",
      "accessTokenHash", "refreshTokenHash", "accessExpiresAt", "refreshExpiresAt",
      "refreshGeneration", "createdAt", "updatedAt"
    ) VALUES (
      ${sessionId}, ${authorization.id}, ${user.id}, ${account.id},
      ${authorization.deviceId},
      ${hashAgentAccessToken(accessToken, input.pepper)},
      ${hashAgentRefreshToken(refreshToken, input.pepper)},
      ${accessExpiresAt}, ${refreshExpiresAt}, 0, NOW(), NOW()
    )
  `;

  await tx.$executeRaw`
    UPDATE "AgentDeviceAuthorization"
       SET "status" = 'CONSUMED',
           "consumedAt" = NOW(),
           "handoffExpiresAt" = ${handoffExpiresAt},
           "sessionId" = ${sessionId},
           "tokenBundleCiphertext" = ${tokenBundleCiphertext},
           "updatedAt" = NOW()
     WHERE "id" = ${authorization.id}
       AND "status" = 'APPROVED'
  `;

  return Object.freeze({ status: "approved" as const, ...bundle });
}
