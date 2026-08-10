import { describe, expect, it } from "vitest";
import { parseTrustedSupplyChainKeys, resolveTrustedSupplyChainKey } from "@/lib/supply-chain/keyring";

describe("supply-chain trusted keyring", () => {
  it("verifies historical and active key IDs without confusing licensing keys", () => {
    const keys = JSON.stringify({ active: "a".repeat(64), historical: "h".repeat(64) });
    expect(resolveTrustedSupplyChainKey(keys, "active", undefined, "historical")).toEqual({ keyId: "historical", key: "h".repeat(64) });
    expect(resolveTrustedSupplyChainKey(keys, "active", undefined)).toEqual({ keyId: "active", key: "a".repeat(64) });
  });
  it("rejects unknown, malformed, or retired key IDs", () => {
    expect(() => resolveTrustedSupplyChainKey(JSON.stringify({ active: "a".repeat(64) }), "active", undefined, "retired")).toThrow("SUPPLY_CHAIN_TRUST_KEY_NOT_CONFIGURED");
    expect(() => parseTrustedSupplyChainKeys("not-json", "active")).toThrow("SUPPLY_CHAIN_TRUST_KEYRING_INVALID");
  });
});
