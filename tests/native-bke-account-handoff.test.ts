import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("native BKE account handoff", () => {
  it("validates credentials through the released Identity capability without creating a browser session", () => {
    const route = read("app/api/agent-sessions/native/login/route.ts");
    expect(route).toContain("IDENTITY_PASSWORD_AUTHENTICATION_CAPABILITY_ID");
    expect(route).toContain("passwordAuthentication.authenticate");
    expect(route).toContain("rejectBrowserOriginForAgent");
    expect(route).toContain("requireAgentAccountSessionProtocol");
    expect(route).not.toContain("createSession");
    expect(route).not.toContain("writeIdentitySessionCookie");
    expect(route).not.toContain("cookies()");
  });

  it("keeps password material out of the persisted handoff and supports account selection", () => {
    const route = read("app/api/agent-sessions/native/login/route.ts");
    const helper = read("apps/web/agent-sessions/native-handoff.ts");
    expect(route).toContain('status: "account_selection_required"');
    expect(route).toContain("customer_account_id");
    expect(route).toContain("handoff_code");
    expect(helper).not.toContain("password");
    expect(helper).toContain("'NATIVE_HANDOFF', 'APPROVED'");
    expect(helper).toContain("hashAgentDeviceCode(handoffCode");
    expect(helper).not.toContain('"handoffCode"');
  });

  it("binds native handoff exchange to the intended device and expires approved grants", () => {
    const service = read("apps/web/agent-sessions/device-authorization.ts");
    const tokenRoute = read("app/api/agent-sessions/device/token/route.ts");
    expect(service).toContain('authorizationKind: "DEVICE_CODE" | "NATIVE_HANDOFF"');
    expect(service).toContain('authorization.authorizationKind === "NATIVE_HANDOFF"');
    expect(service).toContain("input.deviceId.trim() !== authorization.deviceId");
    expect(service).toContain('authorization.status === "APPROVED" && authorization.expiresAt <= now');
    expect(tokenRoute).toContain("device_id");
    expect(tokenRoute).toContain("deviceId: input.device_id");
  });

  it("keeps legacy device-code authorization distinct and migration-safe", () => {
    const migration = read(
      "prisma/migrations/20260923170000_v3_native_bke_account_handoff/migration.sql",
    );
    expect(migration).toContain('"authorizationKind" TEXT NOT NULL DEFAULT \'DEVICE_CODE\'');
    expect(migration).toContain("'DEVICE_CODE','NATIVE_HANDOFF'");
    expect(migration).not.toContain("V2_");
    expect(migration).not.toContain("V3_");
  });
});
