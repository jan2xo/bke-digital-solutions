import { describe, expect, it, vi } from "vitest";
import { resolveProviderSource } from "@/lib/provider-config/policy";

describe("provider configuration source policy", () => {
  it("uses environment directly when selected", async () => {
    const database = vi.fn(async () => "database");
    expect(await resolveProviderSource({ source: "environment", allowEnvironmentFallback: false, database, environment: () => "environment" })).toBe("environment");
    expect(database).not.toHaveBeenCalled();
  });

  it("uses database without consulting environment when available", async () => {
    const environment = vi.fn(() => "environment");
    expect(await resolveProviderSource({ source: "database", allowEnvironmentFallback: true, database: async () => "database", environment })).toBe("database");
    expect(environment).not.toHaveBeenCalled();
  });

  it("fails closed when database resolution fails and fallback is disabled", async () => {
    await expect(resolveProviderSource({ source: "database", allowEnvironmentFallback: false, database: async () => { throw new Error("PROVIDER_CONFIG_DISABLED"); }, environment: () => "environment" })).rejects.toThrow("PROVIDER_CONFIG_DISABLED");
  });

  it("uses environment only when fallback is explicitly enabled", async () => {
    expect(await resolveProviderSource({ source: "database", allowEnvironmentFallback: true, database: async () => { throw new Error("PROVIDER_CONFIG_NOT_FOUND"); }, environment: () => "environment" })).toBe("environment");
  });
});
