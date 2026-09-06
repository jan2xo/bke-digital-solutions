from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    source = target.read_text()
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one replacement target, found {count}: {old[:100]!r}")
    target.write_text(source.replace(old, new, 1))


# Identity module: adopt the released LOGIN challenge reissue capability and make
# the package-manifest omission explicit in the Digital host adapter.
path = "v2/modules/identity/module.ts"
replace_once(
    path,
    'import { IDENTITY_LOGIN_MFA_CHALLENGE_ISSUANCE_CAPABILITY_ID } from "@bke/identity/contracts/login-mfa-challenge.contract";\nimport { IDENTITY_LOGIN_MFA_VERIFICATION_CAPABILITY_ID } from "@bke/identity/contracts/login-mfa-verification.contract";',
    'import { IDENTITY_LOGIN_MFA_CHALLENGE_ISSUANCE_CAPABILITY_ID } from "@bke/identity/contracts/login-mfa-challenge.contract";\nimport { IDENTITY_LOGIN_MFA_CHALLENGE_REISSUE_CAPABILITY_ID } from "@bke/identity/contracts/login-mfa-challenge-reissue.contract";\nimport { IDENTITY_LOGIN_MFA_VERIFICATION_CAPABILITY_ID } from "@bke/identity/contracts/login-mfa-verification.contract";',
)
replace_once(
    path,
    'import { createIdentityLoginMfaChallengeIssuanceCapability } from "@bke/identity/logic/login-mfa-challenge-issuance";\nimport { createIdentityLoginMfaVerificationCapability } from "@bke/identity/logic/login-mfa-verification";',
    'import { createIdentityLoginMfaChallengeIssuanceCapability } from "@bke/identity/logic/login-mfa-challenge-issuance";\nimport { createIdentityLoginMfaChallengeReissueCapability } from "@bke/identity/logic/login-mfa-challenge-reissue";\nimport { createIdentityLoginMfaVerificationCapability } from "@bke/identity/logic/login-mfa-verification";',
)
replace_once(
    path,
    '  const sessionAdministration = createIdentitySessionAdministrationCapability(\n    sessionAdministrationRepository,\n  );\n  const hostManifest = Object.freeze({',
    '  const sessionAdministration = createIdentitySessionAdministrationCapability(\n    sessionAdministrationRepository,\n  );\n  const loginMfaChallengeIssuance = createIdentityLoginMfaChallengeIssuanceCapability(\n    loginMfaChallengeRepository,\n    emailMfaChallengeMaterialProvider,\n  );\n  const loginMfaChallengeReissue = createIdentityLoginMfaChallengeReissueCapability(\n    loginMfaRepository,\n    emailMfaProofProvider,\n    loginMfaChallengeIssuance,\n  );\n  const hostManifest = Object.freeze({',
)
replace_once(
    path,
    '      ...identityModuleManifest.provides,\n      IDENTITY_SESSION_ADMINISTRATION_CAPABILITY_ID,\n',
    '      ...identityModuleManifest.provides,\n      IDENTITY_SESSION_ADMINISTRATION_CAPABILITY_ID,\n      IDENTITY_LOGIN_MFA_CHALLENGE_REISSUE_CAPABILITY_ID,\n',
)
replace_once(
    path,
    '        {\n          id: IDENTITY_LOGIN_MFA_CHALLENGE_ISSUANCE_CAPABILITY_ID,\n          value: createIdentityLoginMfaChallengeIssuanceCapability(\n            loginMfaChallengeRepository,\n            emailMfaChallengeMaterialProvider,\n          ),\n        },',
    '        {\n          id: IDENTITY_LOGIN_MFA_CHALLENGE_ISSUANCE_CAPABILITY_ID,\n          value: loginMfaChallengeIssuance,\n        },\n        {\n          id: IDENTITY_LOGIN_MFA_CHALLENGE_REISSUE_CAPABILITY_ID,\n          value: loginMfaChallengeReissue,\n        },',
)

# V2 web MFA adapter: released Identity owns LOGIN challenge issuance, reissue,
# verification, recovery-code consumption and attempt policy. The host owns cookie
# transport and email delivery effects.
Path("v2/apps/web/auth/mfa-challenge.ts").write_text('''import "server-only";\n\nimport { cookies } from "next/headers";\nimport {\n  IDENTITY_LOGIN_MFA_CHALLENGE_ISSUANCE_CAPABILITY_ID,\n  type IdentityIssuedLoginMfaChallenge,\n  type IdentityLoginMfaChallengeIssuanceCapability,\n} from "@bke/identity/contracts/login-mfa-challenge.contract";\nimport {\n  IDENTITY_LOGIN_MFA_CHALLENGE_REISSUE_CAPABILITY_ID,\n  type IdentityLoginMfaChallengeReissueCapability,\n} from "@bke/identity/contracts/login-mfa-challenge-reissue.contract";\nimport {\n  IDENTITY_LOGIN_MFA_VERIFICATION_CAPABILITY_ID,\n  type IdentityLoginMfaAuthenticationMethod,\n  type IdentityLoginMfaVerificationCapability,\n} from "@bke/identity/contracts/login-mfa-verification.contract";\nimport { audit } from "@/v2/apps/web/audit";\nimport { sendAdministratorLoginCode } from "@/lib/email";\nimport { getV2WebApplication } from "../runtime";\n\nexport const IDENTITY_MFA_CHALLENGE_COOKIE =\n  process.env.NODE_ENV === "production" ? "__Host-bke_mfa_challenge" : "bke_mfa_challenge";\n\nexport const IDENTITY_MFA_CHALLENGE_COOKIE_OPTIONS = {\n  httpOnly: true,\n  secure: process.env.NODE_ENV === "production",\n  sameSite: "strict" as const,\n  path: "/",\n  maxAge: 10 * 60,\n};\n\nexport class IdentityCapabilityError extends Error {\n  readonly code: string;\n  readonly status: number;\n\n  constructor(code: string, status = 503) {\n    super(code);\n    this.code = code;\n    this.status = status;\n  }\n}\n\nexport async function currentIdentityMfaChallengeToken(): Promise<string | null> {\n  return (await cookies()).get(IDENTITY_MFA_CHALLENGE_COOKIE)?.value ?? null;\n}\n\nexport async function deliverIdentityMfaChallenge(input: {\n  readonly userId: string;\n  readonly purpose: "LOGIN" | "RECENT_AUTH" | "ENROLLMENT";\n  readonly delivery: {\n    readonly recipientEmail: string;\n    readonly code: string;\n    readonly reference: string;\n  };\n}): Promise<boolean> {\n  try {\n    await sendAdministratorLoginCode(\n      input.delivery.recipientEmail,\n      input.delivery.code,\n      input.delivery.reference,\n    );\n    return true;\n  } catch {\n    await audit({\n      actorId: input.userId,\n      action: "EMAIL_DELIVERY_FAILED",\n      targetType: "MfaChallenge",\n      targetId: "delivery",\n      metadata: { provider: "resend", purpose: input.purpose },\n    }).catch(() => undefined);\n    return false;\n  }\n}\n\nasync function deliveredLoginChallenge(\n  userId: string,\n  challenge: IdentityIssuedLoginMfaChallenge,\n): Promise<{ token: string; delivered: boolean; reference: string }> {\n  return {\n    token: challenge.challengeToken,\n    delivered: await deliverIdentityMfaChallenge({\n      userId,\n      purpose: "LOGIN",\n      delivery: challenge.delivery,\n    }),\n    reference: challenge.delivery.reference,\n  };\n}\n\nexport async function issueIdentityLoginMfaChallenge(\n  userId: string,\n): Promise<{ token: string; delivered: boolean; reference: string }> {\n  const application = await getV2WebApplication();\n  const issuance = application.get<IdentityLoginMfaChallengeIssuanceCapability>(\n    IDENTITY_LOGIN_MFA_CHALLENGE_ISSUANCE_CAPABILITY_ID,\n  );\n  const result = await issuance.issue({ userId });\n  if (result.status === "REJECTED") throw new Error(result.code);\n  if (result.status === "FAILED") throw new IdentityCapabilityError(result.code);\n  return deliveredLoginChallenge(userId, result.challenge);\n}\n\nexport async function reissueIdentityLoginMfaChallenge(): Promise<{\n  token: string;\n  delivered: boolean;\n  reference: string;\n}> {\n  const challengeToken = await currentIdentityMfaChallengeToken();\n  if (!challengeToken) throw new Error("INVALID_MFA_CHALLENGE");\n\n  const application = await getV2WebApplication();\n  const reissue = application.get<IdentityLoginMfaChallengeReissueCapability>(\n    IDENTITY_LOGIN_MFA_CHALLENGE_REISSUE_CAPABILITY_ID,\n  );\n  const result = await reissue.reissue({ challengeToken });\n  if (result.status === "REJECTED") {\n    throw new Error(\n      result.code === "PRINCIPAL_NOT_FOUND" ? "INVALID_MFA_CHALLENGE" : result.code,\n    );\n  }\n  if (result.status === "FAILED") throw new IdentityCapabilityError(result.code);\n  return deliveredLoginChallenge(\n    result.challenge.delivery.recipientEmail,\n    result.challenge,\n  );\n}\n\nexport async function verifyIdentityLoginMfaChallenge(code: string): Promise<{\n  userId: string;\n  recoveryUsed: boolean;\n  authenticationMethod: IdentityLoginMfaAuthenticationMethod;\n}> {\n  const challengeToken = await currentIdentityMfaChallengeToken();\n  if (!challengeToken) throw new Error("INVALID_MFA_CHALLENGE");\n\n  const application = await getV2WebApplication();\n  const verification = application.get<IdentityLoginMfaVerificationCapability>(\n    IDENTITY_LOGIN_MFA_VERIFICATION_CAPABILITY_ID,\n  );\n  const result = await verification.verify({ challengeToken, code });\n  if (result.status === "INVALID") {\n    throw new Error(\n      result.code === "INVALID_CHALLENGE" ? "INVALID_MFA_CHALLENGE" : "INVALID_MFA_CODE",\n    );\n  }\n  if (result.status === "FAILED") throw new IdentityCapabilityError(result.code);\n  return {\n    userId: result.userId,\n    recoveryUsed: result.authenticationMethod === "PASSWORD_RECOVERY",\n    authenticationMethod: result.authenticationMethod,\n  };\n}\n''')

# Login route: LOGIN challenge issuance moves to released Identity; legacy password
# and session creation remain separate boundaries for later attacks.
path = "app/api/auth/login/route.ts"
replace_once(
    path,
    'import { ADMIN_EMAIL_CHALLENGE_COOKIE, ADMIN_EMAIL_CHALLENGE_COOKIE_OPTIONS, createEmailChallenge } from "@/lib/admin-mfa";',
    'import { IDENTITY_MFA_CHALLENGE_COOKIE, IDENTITY_MFA_CHALLENGE_COOKIE_OPTIONS, issueIdentityLoginMfaChallenge } from "@/v2/apps/web/auth/mfa-challenge";',
)
replace_once(path, 'createEmailChallenge(user.id,"LOGIN")', 'issueIdentityLoginMfaChallenge(user.id)')
replace_once(path, 'ADMIN_EMAIL_CHALLENGE_COOKIE_OPTIONS', 'IDENTITY_MFA_CHALLENGE_COOKIE_OPTIONS')
replace_once(path, 'ADMIN_EMAIL_CHALLENGE_COOKIE', 'IDENTITY_MFA_CHALLENGE_COOKIE')

# Challenge resend route: released Identity reissues by the existing opaque cookie
# token, preserving the legacy no-user-id request shape.
path = "app/api/auth/mfa/challenge/request/route.ts"
replace_once(path, 'import { resendPendingLoginChallenge } from "@/lib/admin-mfa";\n', '')
replace_once(
    path,
    '  IdentityCapabilityError,\n} from "@/v2/apps/web/auth/mfa-challenge";',
    '  IdentityCapabilityError,\n  reissueIdentityLoginMfaChallenge,\n} from "@/v2/apps/web/auth/mfa-challenge";',
)
replace_once(path, 'challenge = await resendPendingLoginChallenge();', 'challenge = await reissueIdentityLoginMfaChallenge();')

# Challenge completion route: released Identity owns challenge/recovery verification
# and consumption. Legacy session issuance remains directly visible as its own V1
# boundary and is not hidden behind an adapter.
Path("app/api/auth/mfa/challenge/route.ts").write_text('''import { NextResponse } from "next/server";\nimport { z } from "zod";\nimport { createSession } from "@/lib/auth";\nimport {\n  IDENTITY_MFA_CHALLENGE_COOKIE,\n  verifyIdentityLoginMfaChallenge,\n} from "@/v2/apps/web/auth/mfa-challenge";\nimport { apiError } from "@/v2/apps/web/http/api-error";\nimport { assertSameOrigin, clientIp } from "@/v2/apps/web/http/request";\nimport { rateLimit } from "@/v2/apps/web/http/rate-limit";\nimport { securityEvent } from "@/v2/apps/web/security/events";\n\nexport async function POST(request: Request) {\n  try {\n    assertSameOrigin(request);\n    if (!(await rateLimit(`admin-mfa:${clientIp(request)}`, 8, 900)).allowed) {\n      await securityEvent("SECURITY_RATE_LIMIT_TRIGGERED", request, undefined, { reason: "mfa" });\n      throw new Error("RATE_LIMITED");\n    }\n    const { code } = z.object({ code: z.string().min(6).max(32) }).parse(await request.json());\n    const verified = await verifyIdentityLoginMfaChallenge(code);\n    const session = await createSession(verified.userId, request, {\n      mfaVerified: true,\n      recent: true,\n      authenticationMethod: verified.authenticationMethod,\n    });\n    const result = { ...verified, sessionId: session.id };\n    await securityEvent(\n      result.recoveryUsed ? "MFA_RECOVERY_USED" : "MFA_CHALLENGE_SUCCEEDED",\n      request,\n      result.userId,\n      undefined,\n      { sessionId: result.sessionId, authenticationMethod: result.authenticationMethod },\n    );\n    await securityEvent("ADMIN_LOGIN_SUCCEEDED", request, result.userId, undefined, {\n      sessionId: result.sessionId,\n      authenticationMethod: result.authenticationMethod,\n    });\n    await securityEvent("ADMIN_SESSION_CREATED", request, result.userId, undefined, {\n      sessionId: result.sessionId,\n      authenticationMethod: result.authenticationMethod,\n    });\n    const response = NextResponse.json({ ok: true });\n    response.cookies.delete(IDENTITY_MFA_CHALLENGE_COOKIE);\n    return response;\n  } catch (error) {\n    if (!(error instanceof Error && error.message === "INVALID_MFA_CODE")) {\n      await securityEvent("MFA_CHALLENGE_FAILED", request).catch(() => undefined);\n    }\n    return apiError(error);\n  }\n}\n''')

# Identity consumer certification: prove the released reissue capability is wired,
# prove all three LOGIN MFA routes use the V2 adapter, and forbid legacy admin-mfa
# reach-through from those entrypoints.
path = "v2/modules/identity/test/consumer-adoption.certify.ts"
replace_once(
    path,
    '  sessionsRouteSource,\n] = await Promise.all([',
    '  sessionsRouteSource,\n  installedLoginMfaChallengeReissueContractSource,\n  mfaChallengeHostSource,\n  loginRouteSource,\n  mfaChallengeRequestRouteSource,\n  mfaChallengeRouteSource,\n] = await Promise.all([',
)
replace_once(
    path,
    '  readFile(\n    new URL("../../../../app/api/admin/security/sessions/route.ts", import.meta.url),\n    "utf8",\n  ),\n]);',
    '  readFile(\n    new URL("../../../../app/api/admin/security/sessions/route.ts", import.meta.url),\n    "utf8",\n  ),\n  readFile(\n    new URL("../../../../node_modules/@bke/identity/contracts/login-mfa-challenge-reissue.contract.ts", import.meta.url),\n    "utf8",\n  ),\n  readFile(\n    new URL("../../../apps/web/auth/mfa-challenge.ts", import.meta.url),\n    "utf8",\n  ),\n  readFile(\n    new URL("../../../../app/api/auth/login/route.ts", import.meta.url),\n    "utf8",\n  ),\n  readFile(\n    new URL("../../../../app/api/auth/mfa/challenge/request/route.ts", import.meta.url),\n    "utf8",\n  ),\n  readFile(\n    new URL("../../../../app/api/auth/mfa/challenge/route.ts", import.meta.url),\n    "utf8",\n  ),\n]);',
)
replace_once(
    path,
    'if (!sessionsRouteSource.includes("@/v2/apps/web/security/session-administration")) {\n  throw new Error("Admin sessions route does not consume the V2 session-administration host adapter.");\n}\n',
    'if (!sessionsRouteSource.includes("@/v2/apps/web/security/session-administration")) {\n  throw new Error("Admin sessions route does not consume the V2 session-administration host adapter.");\n}\n\nfor (const marker of [\n  "IDENTITY_LOGIN_MFA_CHALLENGE_REISSUE_CAPABILITY_ID",\n  "createIdentityLoginMfaChallengeReissueCapability",\n  "loginMfaChallengeIssuance",\n  "loginMfaChallengeReissue",\n]) {\n  if (!moduleSource.includes(marker)) {\n    throw new Error(`Identity host adapter is missing released LOGIN MFA reissue adoption: ${marker}`);\n  }\n}\nif (!installedLoginMfaChallengeReissueContractSource.includes("bke.identity.login-mfa-challenge-reissue.v1")) {\n  throw new Error("Installed @bke/identity does not expose the released LOGIN MFA challenge reissue capability.");\n}\nfor (const marker of [\n  "IDENTITY_LOGIN_MFA_CHALLENGE_ISSUANCE_CAPABILITY_ID",\n  "IDENTITY_LOGIN_MFA_CHALLENGE_REISSUE_CAPABILITY_ID",\n  "IDENTITY_LOGIN_MFA_VERIFICATION_CAPABILITY_ID",\n  "issueIdentityLoginMfaChallenge",\n  "reissueIdentityLoginMfaChallenge",\n  "verifyIdentityLoginMfaChallenge",\n]) {\n  if (!mfaChallengeHostSource.includes(marker)) {\n    throw new Error(`V2 LOGIN MFA host adapter is missing released Identity composition: ${marker}`);\n  }\n}\nfor (const [name, source] of [\n  ["login", loginRouteSource],\n  ["challenge request", mfaChallengeRequestRouteSource],\n  ["challenge completion", mfaChallengeRouteSource],\n] as const) {\n  if (source.includes("@/lib/admin-mfa")) {\n    throw new Error(`${name} route still reaches through to V1 admin MFA.`);\n  }\n}\nif (!loginRouteSource.includes("issueIdentityLoginMfaChallenge")) {\n  throw new Error("Login route does not consume released Identity LOGIN MFA issuance through the V2 adapter.");\n}\nif (!mfaChallengeRequestRouteSource.includes("reissueIdentityLoginMfaChallenge")) {\n  throw new Error("LOGIN MFA resend route does not consume released Identity reissue through the V2 adapter.");\n}\nif (!mfaChallengeRouteSource.includes("verifyIdentityLoginMfaChallenge")) {\n  throw new Error("LOGIN MFA completion route does not consume released Identity verification through the V2 adapter.");\n}\n',
)

print("admin-mfa retirement patch applied")
