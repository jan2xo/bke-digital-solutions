import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const runtimeConsumers = [
  "app/api/auth/magic/consume/route.ts",
  "app/api/auth/verify/route.ts",
  "app/api/cron/email-outbox/route.ts",
  "app/api/cron/expirations/route.ts",
  "app/api/cron/renewals/route.ts",
  "app/api/cron/scheduler/route.ts",
  "apps/web/legal/render.ts",
  "apps/web/storage/object-storage.ts",
];

describe("legacy environment adapter retirement", () => {
  it("routes surviving runtime configuration through the V2 web host contract", async () => {
    for (const path of runtimeConsumers) {
      const source = await readFile(path, "utf8");
      expect(source).not.toContain("@/platform/host/env");
      expect(source).toContain("@/apps/web/config/environment");
    }
  });

  it("keeps the V2 environment contract independent of the legacy parser", async () => {
    const source = await readFile("apps/web/config/environment.ts", "utf8");
    expect(source).not.toContain("@/platform/host/config/environment");
    expect(source).not.toContain("parseEnvironment");
  });
});
