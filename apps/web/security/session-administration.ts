import "server-only";

import { randomUUID } from "node:crypto";
import {
  IDENTITY_SESSION_ADMINISTRATION_CAPABILITY_ID,
  type IdentitySessionAdministrationCapability,
  type IdentitySessionRevocationAction,
} from "@bke/identity/contracts/session-administration.contract";
import { getPostgresPool } from "../persistence/postgres";
import { getV2WebApplication } from "../runtime";
import { securityEvent } from "./events";
import { persistNotificationOutsideTransaction } from "@/apps/web/notifications/center";

class SessionAdministrationProtocolError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function protocolStatus(code: string): number {
  if (code === "FORBIDDEN" || code === "SESSION_NOT_OWNED") return 403;
  if (code === "PRINCIPAL_NOT_FOUND" || code === "SESSION_NOT_FOUND") return 404;
  if (code === "PERSISTENCE_UNAVAILABLE") return 503;
  return 400;
}

export async function revokeAdministratorSessions(input: {
  request: Request;
  userId: string;
  email: string;
  currentSessionId: string;
  action: IdentitySessionRevocationAction;
  targetSessionId?: string;
}): Promise<{ signedOut: boolean }> {
  const application = await getV2WebApplication();
  const sessionAdministration = application.get<IdentitySessionAdministrationCapability>(
    IDENTITY_SESSION_ADMINISTRATION_CAPABILITY_ID,
  );
  const result = await sessionAdministration.revoke({
    userId: input.userId,
    currentSessionId: input.currentSessionId,
    action: input.action,
    targetSessionId: input.targetSessionId,
  });

  if (result.status !== "REVOKED") {
    throw new SessionAdministrationProtocolError(result.code, protocolStatus(result.code));
  }

  const type =
    input.action === "ONE"
      ? "ADMIN_SESSION_REVOKED"
      : input.action === "OTHERS"
        ? "ADMIN_ALL_OTHER_SESSIONS_REVOKED"
        : "ADMIN_ALL_SESSIONS_REVOKED";
  await securityEvent(
    type,
    input.request,
    input.userId,
    { action: input.action },
    { sessionId: input.action === "ONE" ? input.targetSessionId : input.currentSessionId },
  );

  const outboxId = randomUUID();
  await getPostgresPool().query(
    `INSERT INTO "EmailOutbox"
       ("id", "type", "recipient", "subject", "payload", "status", "attempts", "deduplicationKey", "createdAt")
     VALUES ($1, 'SECURITY_SESSIONS_REVOKED', $2, $3, '{}'::jsonb, 'PENDING', 0, $4, NOW())
     ON CONFLICT ("deduplicationKey") DO NOTHING`,
    [
      outboxId,
      input.email,
      "BKE administrator session access changed",
      `security-session-revocation:${input.userId}:${input.action}:${outboxId}`,
    ],
  );

  await persistNotificationOutsideTransaction({
    source: {
      moduleId: "identity",
      event: "ADMIN_SESSIONS_REVOKED",
      sourceReference: outboxId,
    },
    audience: {
      kind: "PRINCIPAL",
      principalId: input.userId,
    },
    content: {
      title: "Administrator session access changed",
      body: input.action === "ONE"
        ? "An administrator session was revoked."
        : input.action === "OTHERS"
          ? "All other administrator sessions were revoked."
          : "All administrator sessions were revoked.",
      category: "SECURITY",
      data: {
        action: input.action,
      },
    },
    context: {
      trigger: "CUSTOM",
      placementHint: "admin-inbox",
    },
    priority: input.action === "ONE" ? "NORMAL" : "HIGH",
    idempotencyKey: `security-session-revocation:${input.userId}:${input.action}:${outboxId}`,
    createdAt: new Date(),
  });

  return { signedOut: result.signedOut };
}
