import { describe, expect, it } from "vitest";
import { refreshRequiresReplacement, type CurrentCommercialLease, type ExpectedCommercialLease } from "@bke/licensing/logic/refresh-decision";
import { refreshRequiresReplacement as legacyRefreshRequiresReplacement } from "@/lib/licensing/refresh-decision";

const base = { version: "1.0.0", expiresAt: new Date("2027-01-01"), installationId: "install", deviceId: "device", signerKeyId: "key-a", status: "ACTIVE" as const, serverRevision: 1 };
describe("commercial refresh material-change decision", () => {
  it("reuses an unchanged lease", () => expect(refreshRequiresReplacement(base, base)).toBe(false));
  it("requires replacement when version or signer changes", () => {
    expect(refreshRequiresReplacement(base, { ...base, version: "2.0.0" })).toBe(true);
    expect(refreshRequiresReplacement(base, { ...base, signerKeyId: "key-b" })).toBe(true);
  });
  it("fails closed for non-active state", () => expect(refreshRequiresReplacement({ ...base, status: "SUPERSEDED" }, base)).toBe(true));

  it("preserves the V1 predicate across expiry, version, binding, signer and revision inputs", () => {
    const variants: Partial<CurrentCommercialLease>[] = [
      {}, { expiresAt: null }, { expiresAt: new Date("2027-01-01") },
      { expiresAt: new Date("2027-01-01T00:00:00.001Z") },
      { expiresAt: new Date("2020-01-01") },
      { version: "2.0.0" }, { version: "v1.0.0" }, { version: "" },
      { installationId: "another-install" }, { deviceId: "another-device" },
      { signerKeyId: null }, { signerKeyId: "key-b" },
      { status: "SUPERSEDED" }, { status: "REVOKED" }, { status: "active" },
      { serverRevision: -1 }, { serverRevision: 0 }, { serverRevision: 2 },
    ];
    const expectedVariants: Partial<ExpectedCommercialLease>[] = [
      {}, { expiresAt: null }, { expiresAt: new Date("2027-01-01") },
      { expiresAt: new Date("2027-01-01T00:00:00.001Z") },
      { expiresAt: new Date("2020-01-01") },
      { version: "2.0.0" }, { version: "v1.0.0" }, { version: "" },
      { installationId: "another-install" }, { deviceId: "another-device" },
      { signerKeyId: "key-b" },
    ];
    for (const currentPatch of variants) {
      for (const expectedPatch of expectedVariants) {
        const current = { ...base, ...currentPatch };
        const expected = { ...base, ...expectedPatch };
        expect(refreshRequiresReplacement(current, expected)).toBe(
          legacyRefreshRequiresReplacement(current as Parameters<typeof legacyRefreshRequiresReplacement>[0], expected),
        );
      }
    }
  });

  it("keeps null expiry symmetric and leaves wall-clock expiry validation to the caller", () => {
    expect(refreshRequiresReplacement({ ...base, expiresAt: null }, { ...base, expiresAt: null })).toBe(false);
    expect(refreshRequiresReplacement({ ...base, expiresAt: null }, base)).toBe(true);
    expect(refreshRequiresReplacement(base, { ...base, expiresAt: null })).toBe(true);
    const expired = { ...base, expiresAt: new Date("2020-01-01") };
    expect(refreshRequiresReplacement(expired, expired)).toBe(false);
  });
});
