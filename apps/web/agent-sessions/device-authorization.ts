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
  authorizationKind: "DEVICE_CODE" | "NATIVE_HANDOFF";
  status: "PENDING" | "APPROVED" | "DENIED" | "EXPIRED" | "CONSUMED";
  expiresAt: Date;
  pollIntervalSeconds: number;
  lastPollAt: Date | null;
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
    SELECT "id", "deviceId", "authorizationKind", "status", "expiresAt", "pollIntervalSeconds",
           "lastPollAt", "approvedByUserId", "approvedAccountId", "approvedAt",
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
    return {
      status: authorization.status === "APPROVED"
        ? "ALREADY_APPROVED" as const
        : authorization.status as "DENIED" | "CONSUMED",
    };
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
    deviceId?: string | null;
    pepper: string;
    encryptionKey: string;
  }>,
): Promise<
  | { readonly status: "authorization_pending" | "slow_down" | "access_denied" | "expired_token" }
  | ({ readonly status: "approved" } & AgentAccountTokenBundle)
> {
  const deviceCodeHash = hashAgentDeviceCode(input.deviceCode, input.pepper);
  const rows = await tx.$queryRaw<DeviceAuthorizationRow[]>`
    SELECT "id", "deviceId", "authorizationKind", "status", "expiresAt", "pollIntervalSeconds",
           "lastPollAt", "approvedByUserId", "approvedAccountId", "approvedAt",
           "handoffExpiresAt", "sessionId", "tokenBundleCiphertext"
      FROM "AgentDeviceAuthorization"
     WHERE "deviceCodeHash" = ${deviceCodeHash}
     FOR UPDATE
  `;
  const authorization = rows[0];
  if (!authorization) return { status: "expired_token" };

  const now = new Date();

  if (
    authorization.authorizationKind === "NATIVE_HANDOFF"
    && (!input.deviceId || input.deviceId.trim() !== authorization.deviceId)
  ) {
    return { status: "access_denied" };
  }

  if (authorization.status === "PENDING") {
    if (authorization.expiresAt <= now) {
      await tx.$executeRaw`
        UPDATE "AgentDeviceAuthorization"
           SET "status" = 'EXPIRED', "updatedAt" = NOW()
         WHERE "id" = ${authorization.id}
      `;
      return { status: "expired_token" };
    }

    if (
      authorization.lastPollAt &&
      now.getTime() <
        authorization.lastPollAt.getTime() + authorization.pollIntervalSeconds * 1000
    ) {
      const nextInterval = Math.min(60, authorization.pollIntervalSeconds + 5);
      await tx.$executeRaw`
        UPDATE "AgentDeviceAuthorization"
           SET "pollIntervalSeconds" = ${nextInterval},
               "lastPollAt" = ${now},
               "updatedAt" = NOW()
         WHERE "id" = ${authorization.id}
      `;
      return { status: "slow_down" };
    }

    await tx.$executeRaw`
      UPDATE "AgentDeviceAuthorization"
         SET "lastPollAt" = ${now}, "updatedAt" = NOW()
       WHERE "id" = ${authorization.id}
    `;
    return { status: "authorization_pending" };
  }

  if (authorization.status === "DENIED") return { status: "access_denied" };
  if (authorization.status === "EXPIRED") return { status: "expired_token" };

  if (authorization.status === "APPROVED" && authorization.expiresAt <= now) {
    await tx.$executeRaw`
      UPDATE "AgentDeviceAuthorization"
         SET "status" = 'EXPIRED',
             "tokenBundleCiphertext" = NULL,
             "updatedAt" = NOW()
       WHERE "id" = ${authorization.id}
         AND "status" = 'APPROVED'
    `;
    return { status: "expired_token" };
  }

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
      "accessTokenHash", "accessExpiresAt", "refreshExpiresAt",
      "refreshGeneration", "createdAt", "updatedAt"
    ) VALUES (
      ${sessionId}, ${authorization.id}, ${user.id}, ${account.id},
      ${authorization.deviceId},
      ${hashAgentAccessToken(accessToken, input.pepper)},
      ${accessExpiresAt}, ${refreshExpiresAt}, 0, NOW(), NOW()
    )
  `;

  await tx.$executeRaw`
    INSERT INTO "AgentAccountRefreshToken" (
      "id", "sessionId", "tokenHash", "generation", "status", "expiresAt", "createdAt"
    ) VALUES (
      ${randomUUID()}, ${sessionId}, ${hashAgentRefreshToken(refreshToken, input.pepper)},
      0, 'ACTIVE', ${refreshExpiresAt}, NOW()
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


type AgentAccountSessionRow = Readonly<{
  id: string;
  deviceAuthorizationId: string;
  userId: string;
  accountId: string;
  deviceId: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  refreshGeneration: number;
  revokedAt: Date | null;
}>;

type AgentRefreshTokenRow = Readonly<{
  id: string;
  sessionId: string;
  generation: number;
  status: "ACTIVE" | "ROTATED" | "REVOKED";
  expiresAt: Date;
}>;

async function revokeAgentSessionFamily(
  tx: Prisma.TransactionClient,
  sessionId: string,
  now: Date,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE "AgentAccountSession"
       SET "revokedAt" = COALESCE("revokedAt", ${now}),
           "updatedAt" = NOW()
     WHERE "id" = ${sessionId}
  `;
  await tx.$executeRaw`
    UPDATE "AgentAccountRefreshToken"
       SET "status" = 'REVOKED',
           "revokedAt" = COALESCE("revokedAt", ${now})
     WHERE "sessionId" = ${sessionId}
       AND "status" <> 'REVOKED'
  `;
  await tx.$executeRaw`
    UPDATE "AgentDeviceAuthorization"
       SET "tokenBundleCiphertext" = NULL,
           "handoffExpiresAt" = ${now},
           "updatedAt" = NOW()
     WHERE "sessionId" = ${sessionId}
  `;
}

export async function refreshAgentAccountSession(
  tx: Prisma.TransactionClient,
  input: Readonly<{
    refreshToken: string;
    pepper: string;
  }>,
): Promise<
  | ({ readonly status: "refreshed" } & AgentAccountTokenBundle)
  | { readonly status: "invalid_grant" | "replay_detected" }
> {
  const tokenHash = hashAgentRefreshToken(input.refreshToken, input.pepper);
  const tokens = await tx.$queryRaw<AgentRefreshTokenRow[]>`
    SELECT "id", "sessionId", "generation", "status", "expiresAt"
      FROM "AgentAccountRefreshToken"
     WHERE "tokenHash" = ${tokenHash}
     FOR UPDATE
  `;
  const token = tokens[0];
  if (!token) return { status: "invalid_grant" };

  const sessions = await tx.$queryRaw<AgentAccountSessionRow[]>`
    SELECT "id", "deviceAuthorizationId", "userId", "accountId", "deviceId",
           "accessExpiresAt", "refreshExpiresAt", "refreshGeneration", "revokedAt"
      FROM "AgentAccountSession"
     WHERE "id" = ${token.sessionId}
     FOR UPDATE
  `;
  const session = sessions[0];
  if (!session) return { status: "invalid_grant" };

  const now = new Date();

  if (token.status !== "ACTIVE") {
    await revokeAgentSessionFamily(tx, session.id, now);
    return { status: "replay_detected" };
  }

  if (
    token.expiresAt <= now ||
    session.refreshExpiresAt <= now ||
    session.revokedAt
  ) {
    await revokeAgentSessionFamily(tx, session.id, now);
    return { status: "invalid_grant" };
  }

  let account;
  try {
    account = await requireAgentDeviceAccountAccessInTransaction(
      tx,
      session.userId,
      session.accountId,
    );
  } catch {
    await revokeAgentSessionFamily(tx, session.id, now);
    return { status: "invalid_grant" };
  }

  const user = await tx.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, emailVerified: true, lifecycleState: true },
  });
  if (!user || !user.emailVerified || user.lifecycleState !== "ACTIVE") {
    await revokeAgentSessionFamily(tx, session.id, now);
    return { status: "invalid_grant" };
  }

  const nextGeneration = session.refreshGeneration + 1;
  const accessToken = generateAgentSessionToken();
  const refreshToken = generateAgentSessionToken();
  const accessExpiresAt = new Date(now.getTime() + ACCESS_TOKEN_TTL_MS);

  await tx.$executeRaw`
    UPDATE "AgentAccountRefreshToken"
       SET "status" = 'ROTATED', "rotatedAt" = ${now}
     WHERE "id" = ${token.id}
       AND "status" = 'ACTIVE'
  `;

  await tx.$executeRaw`
    INSERT INTO "AgentAccountRefreshToken" (
      "id", "sessionId", "tokenHash", "generation", "status", "expiresAt", "createdAt"
    ) VALUES (
      ${randomUUID()}, ${session.id},
      ${hashAgentRefreshToken(refreshToken, input.pepper)},
      ${nextGeneration}, 'ACTIVE', ${session.refreshExpiresAt}, NOW()
    )
  `;

  await tx.$executeRaw`
    UPDATE "AgentAccountSession"
       SET "accessTokenHash" = ${hashAgentAccessToken(accessToken, input.pepper)},
           "accessExpiresAt" = ${accessExpiresAt},
           "refreshGeneration" = ${nextGeneration},
           "lastSeenAt" = ${now},
           "updatedAt" = NOW()
     WHERE "id" = ${session.id}
  `;

  await tx.$executeRaw`
    UPDATE "AgentDeviceAuthorization"
       SET "tokenBundleCiphertext" = NULL,
           "handoffExpiresAt" = ${now},
           "updatedAt" = NOW()
     WHERE "sessionId" = ${session.id}
  `;

  return Object.freeze({
    status: "refreshed" as const,
    sessionId: session.id,
    accessToken,
    refreshToken,
    accessExpiresAt: accessExpiresAt.toISOString(),
    refreshExpiresAt: session.refreshExpiresAt.toISOString(),
    userId: user.id,
    email: user.email,
    accountId: account.id,
    accountType: account.type,
    accountDisplayName: account.displayName,
  });
}

export async function authenticateAgentAccessToken(
  tx: Prisma.TransactionClient,
  input: Readonly<{ accessToken: string; pepper: string }>,
): Promise<
  | {
      readonly status: "authenticated";
      readonly sessionId: string;
      readonly userId: string;
      readonly accountId: string;
      readonly deviceId: string;
    }
  | { readonly status: "invalid_token" }
> {
  const hash = hashAgentAccessToken(input.accessToken, input.pepper);
  const sessions = await tx.$queryRaw<AgentAccountSessionRow[]>`
    SELECT "id", "deviceAuthorizationId", "userId", "accountId", "deviceId",
           "accessExpiresAt", "refreshExpiresAt", "refreshGeneration", "revokedAt"
      FROM "AgentAccountSession"
     WHERE "accessTokenHash" = ${hash}
     FOR UPDATE
  `;
  const session = sessions[0];
  const now = new Date();
  if (!session || session.revokedAt || session.accessExpiresAt <= now) {
    return { status: "invalid_token" };
  }

  try {
    await requireAgentDeviceAccountAccessInTransaction(
      tx,
      session.userId,
      session.accountId,
    );
  } catch {
    await revokeAgentSessionFamily(tx, session.id, now);
    return { status: "invalid_token" };
  }

  const user = await tx.user.findUnique({
    where: { id: session.userId },
    select: { emailVerified: true, lifecycleState: true },
  });
  if (!user?.emailVerified || user.lifecycleState !== "ACTIVE") {
    await revokeAgentSessionFamily(tx, session.id, now);
    return { status: "invalid_token" };
  }

  await tx.$executeRaw`
    UPDATE "AgentAccountSession"
       SET "lastSeenAt" = ${now}, "updatedAt" = NOW()
     WHERE "id" = ${session.id}
  `;

  return Object.freeze({
    status: "authenticated" as const,
    sessionId: session.id,
    userId: session.userId,
    accountId: session.accountId,
    deviceId: session.deviceId,
  });
}

export async function acknowledgeAgentSessionHandoff(
  tx: Prisma.TransactionClient,
  input: Readonly<{ accessToken: string; pepper: string }>,
): Promise<"acknowledged" | "invalid_token"> {
  const authenticated = await authenticateAgentAccessToken(tx, input);
  if (authenticated.status !== "authenticated") return "invalid_token";

  await tx.$executeRaw`
    UPDATE "AgentDeviceAuthorization"
       SET "tokenBundleCiphertext" = NULL,
           "handoffExpiresAt" = NOW(),
           "updatedAt" = NOW()
     WHERE "sessionId" = ${authenticated.sessionId}
  `;
  return "acknowledged";
}

export async function revokeAgentAccountSession(
  tx: Prisma.TransactionClient,
  input: Readonly<{ refreshToken: string; pepper: string }>,
): Promise<"revoked" | "not_found"> {
  const tokenHash = hashAgentRefreshToken(input.refreshToken, input.pepper);
  const rows = await tx.$queryRaw<Array<{ sessionId: string }>>`
    SELECT "sessionId"
      FROM "AgentAccountRefreshToken"
     WHERE "tokenHash" = ${tokenHash}
     FOR UPDATE
  `;
  const row = rows[0];
  if (!row) return "not_found";
  await revokeAgentSessionFamily(tx, row.sessionId, new Date());
  return "revoked";
}


export async function cancelAgentDeviceAuthorization(
  tx: Prisma.TransactionClient,
  input: Readonly<{ deviceCode: string; pepper: string }>,
): Promise<"cancelled" | "not_found"> {
  const deviceCodeHash = hashAgentDeviceCode(input.deviceCode, input.pepper);
  const changed = await tx.$executeRaw`
    UPDATE "AgentDeviceAuthorization"
       SET "status" = 'DENIED',
           "deniedAt" = NOW(),
           "tokenBundleCiphertext" = NULL,
           "updatedAt" = NOW()
     WHERE "deviceCodeHash" = ${deviceCodeHash}
       AND "status" IN ('PENDING','APPROVED')
  `;
  return changed > 0 ? "cancelled" : "not_found";
}
