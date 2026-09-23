import "server-only";

import { randomUUID } from "node:crypto";
import type { IdentityPrincipal } from "@bke/identity/contracts/identity.contract";
import type { Prisma } from "@/platform/persistence/generated/prisma/client";
import {
  listAgentDeviceAccountsInTransaction,
  requireAgentDeviceAccountAccessInTransaction,
} from "@/apps/web/accounts/agent-device-session-authorization";
import {
  generateAgentDeviceCode,
  generateAgentUserCode,
  hashAgentDeviceCode,
  hashAgentUserCode,
} from "./material";

const NATIVE_HANDOFF_TTL_MS = 90 * 1000;

function validDeviceId(value: string): boolean {
  return /^[A-Za-z0-9._:-]{16,256}$/.test(value);
}

function validPlatform(value: string): boolean {
  return value === "windows" || value === "macos" || value === "linux";
}

function validArchitecture(value: string): boolean {
  return value === "x64" || value === "arm64" || value === "x86";
}

export async function resolveNativeBkeAccounts(
  tx: Prisma.TransactionClient,
  principalId: string,
) {
  return listAgentDeviceAccountsInTransaction(tx, principalId);
}

export async function issueNativeBkeAgentHandoff(
  tx: Prisma.TransactionClient,
  input: Readonly<{
    principal: IdentityPrincipal;
    accountId: string;
    deviceId: string;
    deviceName?: string | null;
    platform: string;
    architecture: string;
    pepper: string;
  }>,
) {
  const deviceId = input.deviceId.trim();
  const deviceName = input.deviceName?.trim() || null;
  const platform = input.platform.trim().toLowerCase();
  const architecture = input.architecture.trim().toLowerCase();

  if (
    !validDeviceId(deviceId)
    || (deviceName !== null && deviceName.length > 128)
    || !validPlatform(platform)
    || !validArchitecture(architecture)
  ) {
    throw new Error("INVALID_AGENT_DEVICE");
  }
  if (
    input.principal.role !== "CUSTOMER"
    || !input.principal.emailVerified
    || input.principal.lifecycleState !== "ACTIVE"
  ) {
    throw new Error("FORBIDDEN");
  }

  const account = await requireAgentDeviceAccountAccessInTransaction(
    tx,
    input.principal.id,
    input.accountId,
  );

  const id = randomUUID();
  const handoffCode = generateAgentDeviceCode();
  const unusedUserCode = generateAgentUserCode();
  const expiresAt = new Date(Date.now() + NATIVE_HANDOFF_TTL_MS);

  await tx.$executeRaw`
    INSERT INTO "AgentDeviceAuthorization" (
      "id", "deviceCodeHash", "userCodeHash", "deviceId", "deviceName",
      "platform", "architecture", "authorizationKind", "status", "expiresAt",
      "pollIntervalSeconds", "approvedByUserId", "approvedAccountId", "approvedAt",
      "createdAt", "updatedAt"
    ) VALUES (
      ${id},
      ${hashAgentDeviceCode(handoffCode, input.pepper)},
      ${hashAgentUserCode(unusedUserCode, input.pepper)},
      ${deviceId}, ${deviceName}, ${platform}, ${architecture},
      'NATIVE_HANDOFF', 'APPROVED', ${expiresAt}, 2,
      ${input.principal.id}, ${account.id}, NOW(), NOW(), NOW()
    )
  `;

  await tx.auditLog.create({
    data: {
      actorId: input.principal.id,
      accountId: account.id,
      action: "AGENT_NATIVE_HANDOFF_ISSUED",
      targetType: "AgentDeviceAuthorization",
      targetId: id,
      metadata: {
        deviceId,
        accountRole: account.effectiveRole,
        expiresAt: expiresAt.toISOString(),
      },
    },
  });

  return Object.freeze({
    handoffCode,
    expiresAt,
    expiresIn: Math.floor(NATIVE_HANDOFF_TTL_MS / 1000),
    account,
  });
}
