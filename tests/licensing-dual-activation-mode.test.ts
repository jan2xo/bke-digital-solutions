import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  allowsProductActivation,
  assertSafeProductActivationModeChange,
  productActivationModes,
} from "@/apps/web/licensing/product-activation-mode";

function state(overrides: Partial<Parameters<typeof assertSafeProductActivationModeChange>[0]> = {}) {
  return {
    previousMode: "EITHER",
    requestedMode: "LICENSE_KEY",
    active: false,
    publishedAt: null,
    publishedEver: false,
    versionsCount: 0,
    licensesCount: 0,
    subscriptionsCount: 0,
    orderItemsCount: 0,
    ...overrides,
  };
}

describe("Digital Solutions dual-path product activation — signed lease policy", () => {
  it("provides a strict and exhaustive credential matrix", () => {
    expect(productActivationModes).toEqual(["ACCOUNT", "LICENSE_KEY", "EITHER"]);
    expect(allowsProductActivation("ACCOUNT", "ACCOUNT")).toBe(true);
    expect(allowsProductActivation("ACCOUNT", "LICENSE_KEY")).toBe(false);
    expect(allowsProductActivation("LICENSE_KEY", "ACCOUNT")).toBe(false);
    expect(allowsProductActivation("LICENSE_KEY", "LICENSE_KEY")).toBe(true);
    expect(allowsProductActivation("EITHER", "ACCOUNT")).toBe(true);
    expect(allowsProductActivation("EITHER", "LICENSE_KEY")).toBe(true);
  });

  it("fails closed on unknown and forged modes, without treating google as a right", () => {
    for (const mode of ["GOOGLE", "Commercial", "FREE", "UNKNOWN", "", null, undefined, {}, false]) {
      expect(allowsProductActivation(mode, "ACCOUNT")).toBe(false);
      expect(allowsProductActivation(mode, "LICENSE_KEY")).toBe(false);
    }
    expect(allowsProductActivation("EITHER", "GOOGLE" as never)).toBe(false);
  });

  it("allows new unsold drafts to choose one activation method, or both", () => {
    expect(() => assertSafeProductActivationModeChange(state())).not.toThrow();
    expect(() => assertSafeProductActivationModeChange(state({
      previousMode: "ACCOUNT", requestedMode: "LICENSE_KEY",
    }))).not.toThrow();
    expect(() => assertSafeProductActivationModeChange(state({
      previousMode: "ACCOUNT", requestedMode: "EITHER",
    }))).not.toThrow();
  });

  it("does not break existing published, versioned, purchased or licensed products", () => {
    const locked = [
      { active: true },
      { publishedAt: new Date("2026-01-01") },
      { publishedEver: true },
      { versionsCount: 1 },
      { licensesCount: 1 },
      { subscriptionsCount: 1 },
      { orderItemsCount: 1 },
      { versionsCount: -1 },
      { licensesCount: Number.NaN },
    ];
    for (const extra of locked) {
      expect(() => assertSafeProductActivationModeChange(state(extra)))
        .toThrow("PRODUCT_ACTIVATION_MODE_LOCKED");
    }
    // An unchanged policy is never silently rewritten as another mode.
    expect(() => assertSafeProductActivationModeChange(state({
      previousMode: "LICENSE_KEY", requestedMode: "LICENSE_KEY", active: true,
    }))).not.toThrow();
  });

  it("rejects unsupported persisted values or manipulated admin input", () => {
    expect(() => assertSafeProductActivationModeChange(state({
      previousMode: "Commercial",
    }))).toThrow("PRODUCT_ACTIVATION_MODE_INVALID");
    expect(() => assertSafeProductActivationModeChange(state({
      requestedMode: "GOOGLE",
    }))).toThrow("PRODUCT_ACTIVATION_MODE_INVALID");
  });

  it("preserves separate authenticated account and key-only routes, with no fake account identifiers", () => {
    const code = (path: string) => readFileSync(path, "utf8");
    const keyLease = code("apps/web/licensing/commercial-lease.ts");
    const refresh = code("app/api/licenses/refresh/route.ts");
    const reveal = code("app/api/licenses/[id]/reveal/route.ts");
    const account = code("apps/web/agent-sessions/product-lease-eligibility.ts");
    const create = code("app/api/admin/products/route.ts");
    const update = code("app/api/admin/products/[id]/route.ts");
    const migration = code("prisma/migrations/20261112080000_product_activation_mode_dual_path/migration.sql");

    expect(keyLease).toContain('allowsProductActivation(rows[0]!.activationMode, "LICENSE_KEY")');
    expect(keyLease).toContain("hashLicenseKey(licenseKey)");
    expect(keyLease).toContain("return capability.issue(input)");
    expect(keyLease).not.toContain("requireRecentUser");
    expect(keyLease).not.toContain("requireGoogle");
    expect(keyLease).not.toContain("synthetic");
    expect(refresh).toContain("await requireCommercialLicenseKeyActivation(input.licenseKey)");
    expect(reveal).toContain('allowsProductActivation(modes[0]!.activationMode, "LICENSE_KEY")');
    expect(account).toContain('allowsProductActivation(productPolicy[0]!.activationMode, "ACCOUNT")');
    expect(account).toContain("authenticateAgentAccessToken(tx,");
    expect(create).toContain('activationMode: z.enum(productActivationModes).default("EITHER")');
    expect(update).toContain("assertSafeProductActivationModeChange(");
    expect(update).toContain("FOR UPDATE");
    expect(update).toContain("await tx.auditLog.create(");
    expect(update).toContain('action: "PRODUCT_ACTIVATION_MODE_CHANGED"');
    expect(migration).toContain('CREATE TABLE "ProductActivationPolicy"');
    expect(keyLease).toContain('JOIN "ProductActivationPolicy" policy');
    expect(account).toContain('JOIN "ProductActivationPolicy" policy');
    expect(account).toContain("ProductActivationPolicy");
    expect(migration).toContain("ProductActivationPolicy_mode_supported_check");
    expect(migration).toContain('INSERT INTO "ProductActivationPolicy" ("productId", "activationMode", "publishedEver")');
    expect(migration).toContain('SELECT p."id", \'EITHER\',');
    expect(migration).toContain('p."active" OR p."publishedAt" IS NOT NULL');
    expect(migration).toContain('CREATE TRIGGER "ProductActivationPolicy_default_on_create"');
    expect(migration).toContain('CREATE TRIGGER "ProductActivationPolicy_mark_published"');
    expect(update).toContain('publishedEver: rows[0]!.publishedEver');
    expect(update).toContain('tx.subscription.count({ where: { productId: id } })');
    expect(migration).not.toMatch(/\bDROP\s+TABLE\b|\bDELETE\s+FROM\b/i);
  });
});
