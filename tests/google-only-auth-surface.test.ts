import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
describe("removed alternative authentication entrypoints", () => {
  it.each([
    "app/api/auth/login/route.ts", "app/api/auth/register/route.ts",
    "app/api/auth/magic/request/route.ts", "app/api/auth/magic/consume/route.ts",
    "app/api/auth/password-reset/request/route.ts", "app/api/auth/password-reset/consume/route.ts",
    "app/api/auth/password/change/route.ts", "app/api/auth/verify/route.ts",
    "app/api/auth/verification/resend/route.ts", "app/api/auth/mfa",
    "app/api/agent-sessions/native/login/route.ts", "app/api/agent-sessions/native/register/route.ts",
    "app/api/agent-sessions/native/mfa", "app/api/agent-sessions/native/password-reset",
    "app/api/agent-sessions/native/verify-email", "app/api/agent-sessions/native/verification",
    "app/api/agent-sessions/account/mfa", "app/api/agent-sessions/account/password-change",
    "app/api/agent-sessions/account/recent-auth",
  ])("does not expose %s", (path) => { expect(existsSync(path)).toBe(false); });
});
