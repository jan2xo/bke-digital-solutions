from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    source = target.read_text()
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one replacement target, found {count}: {old[:80]!r}")
    target.write_text(source.replace(old, new, 1))


# Identity module: adopt the released session-administration capability and make the
# package-manifest omission explicit in the host adapter.
path = "v2/modules/identity/module.ts"
replace_once(
    path,
    'import { IDENTITY_SESSION_TERMINATION_CAPABILITY_ID } from "@bke/identity/contracts/session-termination.contract";',
    'import { IDENTITY_SESSION_ADMINISTRATION_CAPABILITY_ID } from "@bke/identity/contracts/session-administration.contract";\nimport { IDENTITY_SESSION_TERMINATION_CAPABILITY_ID } from "@bke/identity/contracts/session-termination.contract";',
)
replace_once(
    path,
    'import { createIdentitySessionIssuanceCapability } from "@bke/identity/logic/session-issuance";\nimport { createIdentitySessionTerminationCapability } from "@bke/identity/logic/session-termination";',
    'import { createIdentitySessionIssuanceCapability } from "@bke/identity/logic/session-issuance";\nimport { createIdentitySessionAdministrationCapability } from "@bke/identity/logic/session-administration";\nimport { createIdentitySessionTerminationCapability } from "@bke/identity/logic/session-termination";',
)
replace_once(
    path,
    'import { createPostgresIdentitySessionRepository } from "@bke/identity/prisma/repositories/postgres-session-repository";\nimport { createPostgresIdentitySessionTerminationRepository } from "@bke/identity/prisma/repositories/postgres-session-termination-repository";',
    'import { createPostgresIdentitySessionRepository } from "@bke/identity/prisma/repositories/postgres-session-repository";\nimport { createPostgresIdentitySessionAdministrationRepository } from "@bke/identity/prisma/repositories/postgres-session-administration-repository";\nimport { createPostgresIdentitySessionTerminationRepository } from "@bke/identity/prisma/repositories/postgres-session-termination-repository";',
)
replace_once(
    path,
    '  const sessionTerminationRepository =\n    createPostgresIdentitySessionTerminationRepository(options.connectionString);',
    '  const sessionTerminationRepository =\n    createPostgresIdentitySessionTerminationRepository(options.connectionString);\n  const sessionAdministrationRepository =\n    createPostgresIdentitySessionAdministrationRepository(options.connectionString);',
)
replace_once(
    path,
    '  const sessionValidation = createIdentitySessionValidationCapability(\n    sessionRepository,\n    sessionTokenProvider,\n  );\n\n  return Object.freeze({\n    manifest: identityModuleManifest,',
    '  const sessionValidation = createIdentitySessionValidationCapability(\n    sessionRepository,\n    sessionTokenProvider,\n  );\n  const sessionAdministration = createIdentitySessionAdministrationCapability(\n    sessionAdministrationRepository,\n  );\n  const hostManifest = Object.freeze({\n    ...identityModuleManifest,\n    provides: [\n      ...identityModuleManifest.provides,\n      IDENTITY_SESSION_ADMINISTRATION_CAPABILITY_ID,\n    ],\n  });\n\n  return Object.freeze({\n    manifest: hostManifest,',
)
replace_once(
    path,
    '        {\n          id: IDENTITY_SESSION_TERMINATION_CAPABILITY_ID,\n          value: createIdentitySessionTerminationCapability(',
    '        {\n          id: IDENTITY_SESSION_ADMINISTRATION_CAPABILITY_ID,\n          value: sessionAdministration,\n        },\n        {\n          id: IDENTITY_SESSION_TERMINATION_CAPABILITY_ID,\n          value: createIdentitySessionTerminationCapability(',
)

# Narrow host adapter: Identity owns the revocation; the web host owns security and
# durable notification effects.
adapter = Path("v2/apps/web/security/session-administration.ts")
adapter.parent.mkdir(parents=True, exist_ok=True)
adapter.write_text('''import "server-only";\n\nimport { randomUUID } from "node:crypto";\nimport {\n  IDENTITY_SESSION_ADMINISTRATION_CAPABILITY_ID,\n  type IdentitySessionAdministrationCapability,\n  type IdentitySessionRevocationAction,\n} from "@bke/identity/contracts/session-administration.contract";\nimport { getPostgresPool } from "../persistence/postgres";\nimport { getV2WebApplication } from "../runtime";\nimport { securityEvent } from "./events";\n\nclass SessionAdministrationProtocolError extends Error {\n  readonly code: string;\n  readonly status: number;\n\n  constructor(code: string, status: number) {\n    super(code);\n    this.code = code;\n    this.status = status;\n  }\n}\n\nfunction protocolStatus(code: string): number {\n  if (code === "FORBIDDEN" || code === "SESSION_NOT_OWNED") return 403;\n  if (code === "PRINCIPAL_NOT_FOUND" || code === "SESSION_NOT_FOUND") return 404;\n  if (code === "PERSISTENCE_UNAVAILABLE") return 503;\n  return 400;\n}\n\nexport async function revokeAdministratorSessions(input: {\n  request: Request;\n  userId: string;\n  email: string;\n  currentSessionId: string;\n  action: IdentitySessionRevocationAction;\n  targetSessionId?: string;\n}): Promise<{ signedOut: boolean }> {\n  const application = await getV2WebApplication();\n  const sessionAdministration = application.get<IdentitySessionAdministrationCapability>(\n    IDENTITY_SESSION_ADMINISTRATION_CAPABILITY_ID,\n  );\n  const result = await sessionAdministration.revoke({\n    userId: input.userId,\n    currentSessionId: input.currentSessionId,\n    action: input.action,\n    targetSessionId: input.targetSessionId,\n  });\n\n  if (result.status !== "REVOKED") {\n    throw new SessionAdministrationProtocolError(result.code, protocolStatus(result.code));\n  }\n\n  const type =\n    input.action === "ONE"\n      ? "ADMIN_SESSION_REVOKED"\n      : input.action === "OTHERS"\n        ? "ADMIN_ALL_OTHER_SESSIONS_REVOKED"\n        : "ADMIN_ALL_SESSIONS_REVOKED";\n  await securityEvent(\n    type,\n    input.request,\n    input.userId,\n    { action: input.action },\n    { sessionId: input.action === "ONE" ? input.targetSessionId : input.currentSessionId },\n  );\n\n  const outboxId = randomUUID();\n  await getPostgresPool().query(\n    `INSERT INTO "EmailOutbox"\n       ("id", "type", "recipient", "subject", "payload", "status", "attempts", "deduplicationKey", "createdAt")\n     VALUES ($1, 'SECURITY_SESSIONS_REVOKED', $2, $3, '{}'::jsonb, 'PENDING', 0, $4, NOW())\n     ON CONFLICT ("deduplicationKey") DO NOTHING`,\n    [\n      outboxId,\n      input.email,\n      "BKE administrator session access changed",\n      `security-session-revocation:${input.userId}:${input.action}:${outboxId}`,\n    ],\n  );\n\n  return { signedOut: result.signedOut };\n}\n''')

# Route: remove the V1 session-administration dependency while preserving its
# existing recent-admin auth/cookie boundary for this narrow retirement slice.
path = "app/api/admin/security/sessions/route.ts"
replace_once(
    path,
    'import { revokeAdministratorSessions } from "@/lib/security/session-administration";',
    'import { revokeAdministratorSessions } from "@/v2/apps/web/security/session-administration";',
)
replace_once(
    path,
    '    const result = await revokeAdministratorSessions({ userId: session.userId, currentSessionId: session.id, action: input.action, targetSessionId: input.action === "ONE" ? input.sessionId : undefined });',
    '    const result = await revokeAdministratorSessions({ request, userId: session.userId, email: session.user.email, currentSessionId: session.id, action: input.action, targetSessionId: input.action === "ONE" ? input.sessionId : undefined });',
)

# Consumer certification: pin the explicit host-manifest augmentation and forbid
# the retired route import.
path = "v2/modules/identity/test/consumer-adoption.certify.ts"
replace_once(
    path,
    '  installedIdentityContractSource,\n] = await Promise.all([',
    '  installedIdentityContractSource,\n  installedSessionAdministrationContractSource,\n  sessionAdministrationHostSource,\n  sessionsRouteSource,\n] = await Promise.all([',
)
replace_once(
    path,
    '  readFile(\n    new URL("../../../../node_modules/@bke/identity/contracts/identity.contract.ts", import.meta.url),\n    "utf8",\n  ),\n]);',
    '  readFile(\n    new URL("../../../../node_modules/@bke/identity/contracts/identity.contract.ts", import.meta.url),\n    "utf8",\n  ),\n  readFile(\n    new URL("../../../../node_modules/@bke/identity/contracts/session-administration.contract.ts", import.meta.url),\n    "utf8",\n  ),\n  readFile(\n    new URL("../../../apps/web/security/session-administration.ts", import.meta.url),\n    "utf8",\n  ),\n  readFile(\n    new URL("../../../../app/api/admin/security/sessions/route.ts", import.meta.url),\n    "utf8",\n  ),\n]);',
)
replace_once(
    path,
    'if (!installedIdentityContractSource.includes("readonly establishedAt: Date;")) {\n  throw new Error(\n    "Installed @bke/identity contract does not expose the canonical principal establishment fact.",\n  );\n}\n',
    'if (!installedIdentityContractSource.includes("readonly establishedAt: Date;")) {\n  throw new Error(\n    "Installed @bke/identity contract does not expose the canonical principal establishment fact.",\n  );\n}\n\nfor (const marker of [\n  "IDENTITY_SESSION_ADMINISTRATION_CAPABILITY_ID",\n  "createIdentitySessionAdministrationCapability",\n  "createPostgresIdentitySessionAdministrationRepository",\n  "...identityModuleManifest.provides",\n]) {\n  if (!moduleSource.includes(marker)) {\n    throw new Error(`Identity host adapter is missing released session-administration adoption: ${marker}`);\n  }\n}\nif (!installedSessionAdministrationContractSource.includes("bke.identity.session-administration.v1")) {\n  throw new Error("Installed @bke/identity does not expose the released session-administration capability.");\n}\nfor (const marker of [\n  "IDENTITY_SESSION_ADMINISTRATION_CAPABILITY_ID",\n  "securityEvent(",\n  "SECURITY_SESSIONS_REVOKED",\n  "EmailOutbox",\n]) {\n  if (!sessionAdministrationHostSource.includes(marker)) {\n    throw new Error(`V2 session-administration host adapter is missing required composition/effect surface: ${marker}`);\n  }\n}\nif (sessionsRouteSource.includes("@/lib/security/session-administration")) {\n  throw new Error("Admin sessions route still reaches through to V1 session administration.");\n}\nif (!sessionsRouteSource.includes("@/v2/apps/web/security/session-administration")) {\n  throw new Error("Admin sessions route does not consume the V2 session-administration host adapter.");\n}\n',
)

print("session-administration retirement patch applied")
