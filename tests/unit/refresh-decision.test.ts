import { describe, expect, it } from "vitest";
import { refreshRequiresReplacement } from "@/lib/licensing/refresh-decision";

const base = { version: "1.0.0", expiresAt: new Date("2027-01-01"), installationId: "install", deviceId: "device", signerKeyId: "key-a", status: "ACTIVE" as const, serverRevision: 1 };
describe("commercial refresh material-change decision", () => {
  it("reuses an unchanged lease", () => expect(refreshRequiresReplacement(base, base)).toBe(false));
  it("requires replacement when version or signer changes", () => {
    expect(refreshRequiresReplacement(base, { ...base, version: "2.0.0" })).toBe(true);
    expect(refreshRequiresReplacement(base, { ...base, signerKeyId: "key-b" })).toBe(true);
  });
  it("fails closed for non-active state", () => expect(refreshRequiresReplacement({ ...base, status: "SUPERSEDED" }, base)).toBe(true));
});
