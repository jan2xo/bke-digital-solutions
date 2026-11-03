import { describe, expect, it } from "vitest";
import { POST as webLogin } from "../app/api/auth/login/route";
import { POST as webRegister } from "../app/api/auth/register/route";
import { POST as webPasswordResetRequest } from "../app/api/auth/password-reset/request/route";
import { POST as webPasswordResetConsume } from "../app/api/auth/password-reset/consume/route";
import { POST as webPasswordChange } from "../app/api/auth/password/change/route";
import { POST as nativeLogin } from "../app/api/agent-sessions/native/login/route";
import { POST as nativeRegister } from "../app/api/agent-sessions/native/register/route";
import { POST as nativePasswordResetRequest } from "../app/api/agent-sessions/native/password-reset/request/route";
import { POST as nativePasswordResetComplete } from "../app/api/agent-sessions/native/password-reset/complete/route";
import { POST as nativeMfaVerify } from "../app/api/agent-sessions/native/mfa/verify/route";
import { POST as nativeAccountPasswordChange } from "../app/api/agent-sessions/account/password-change/route";
import { POST as nativeRecentAuthStart } from "../app/api/agent-sessions/account/recent-auth/start/route";
import { POST as nativeMfaChallenge } from "../app/api/agent-sessions/account/mfa/challenge/route";
import { POST as nativeMfaDisable } from "../app/api/agent-sessions/account/mfa/disable/route";
import { POST as nativeMfaEnrollStart } from "../app/api/agent-sessions/account/mfa/enroll/start/route";
import { POST as nativeMfaEnrollComplete } from "../app/api/agent-sessions/account/mfa/enroll/complete/route";
import { POST as nativeMfaRecoveryRegenerate } from "../app/api/agent-sessions/account/mfa/recovery/regenerate/route";

describe("retired Digital Solutions password and native security grants", () => {
  it.each([
    ["web login", webLogin],
    ["web registration", webRegister],
    ["web password reset request", webPasswordResetRequest],
    ["web password reset completion", webPasswordResetConsume],
    ["web password change", webPasswordChange],
    ["native password login", nativeLogin],
    ["native password registration", nativeRegister],
    ["native password reset request", nativePasswordResetRequest],
    ["native password reset completion", nativePasswordResetComplete],
    ["native MFA grant continuation", nativeMfaVerify],
  ])("%s fails closed with a Google handoff response", async (_name, handler) => {
    const response = await handler();
    expect(response.status).toBe(410);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/GOOGLE/),
    });
  });

  it.each([
    ["native password change", nativeAccountPasswordChange],
    ["native recent-auth", nativeRecentAuthStart],
    ["native MFA challenge", nativeMfaChallenge],
    ["native MFA disable", nativeMfaDisable],
    ["native MFA enrollment start", nativeMfaEnrollStart],
    ["native MFA enrollment completion", nativeMfaEnrollComplete],
    ["native MFA recovery regeneration", nativeMfaRecoveryRegenerate],
  ])("%s requires browser security instead of accepting a password recheck", async (_name, handler) => {
    const response = await handler();
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "BROWSER_SECURITY_REQUIRED" });
  });
});
