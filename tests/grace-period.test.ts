import { describe, expect, it, vi } from "vitest";
import type { LicensingGraceAtomicEffectTransaction } from "@bke/licensing/logic/grace-period-ports";
import {
  parseLicensingGraceBoolean,
  parseLicensingGraceProduct,
} from "@bke/licensing/logic/grace-period";
import { createLicensingGraceAuditEffect } from "@/v2/modules/licensing/grace-audit";

describe("operational grace control host adoption", () => {
  it("uses the released Licensing parser contract", () => {
    expect(parseLicensingGraceProduct("airstack")).toBe("airstack");
    expect(parseLicensingGraceProduct("renderdock")).toBe("renderdock");
    expect(parseLicensingGraceBoolean("true")).toBe(true);
    expect(parseLicensingGraceBoolean("false")).toBe(false);
    expect(() => parseLicensingGraceProduct("unknown")).toThrow("Unknown grace product: unknown");
    expect(() => parseLicensingGraceBoolean("on")).toThrow("Grace value must be exactly true or false.");
    expect(() => parseLicensingGraceBoolean("1")).toThrow("Grace value must be exactly true or false.");
  });

  it("maps the Licensing mutation to the exact legacy audit event inside the supplied transaction", async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const transaction: LicensingGraceAtomicEffectTransaction = Object.freeze({ execute });
    const effect = createLicensingGraceAuditEffect();

    await effect.record(
      Object.freeze({
        productKey: "airstack",
        oldValue: false,
        newValue: true,
        operationSource: "VPS_CLI",
      }),
      transaction,
    );

    expect(execute).toHaveBeenCalledTimes(1);
    const [statement, values] = execute.mock.calls[0] as [string, readonly unknown[]];
    expect(statement).toContain('INSERT INTO "AuditLog"');
    expect(values[1]).toBeNull();
    expect(values[2]).toBeNull();
    expect(values[3]).toBe("GRACE_OVERRIDE_SET");
    expect(values[4]).toBe("ProductGraceOverride");
    expect(values[5]).toBe("airstack");
    expect(JSON.parse(String(values[6]))).toEqual({
      product: "airstack",
      oldValue: false,
      newValue: true,
      operationSource: "VPS_CLI",
    });
  });

  it("preserves idempotent-set audit facts without inventing an actor", async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const effect = createLicensingGraceAuditEffect();

    await effect.record(
      Object.freeze({
        productKey: "renderdock",
        oldValue: false,
        newValue: false,
        operationSource: "VPS_CLI",
      }),
      Object.freeze({ execute }),
    );

    const [, values] = execute.mock.calls[0] as [string, readonly unknown[]];
    expect(values[1]).toBeNull();
    expect(values[2]).toBeNull();
    expect(values[5]).toBe("renderdock");
    expect(JSON.parse(String(values[6]))).toMatchObject({
      oldValue: false,
      newValue: false,
      operationSource: "VPS_CLI",
    });
  });
});
