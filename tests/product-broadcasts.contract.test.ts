import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("V2 typed product broadcast boundary", () => {
  it("ships only the approved operational broadcast codes", () => {
    const authority = source("platform/notifications/product-broadcasts.ts");
    expect(authority).toContain('"BETA_ENDED"');
    expect(authority).toContain('"TRIAL_ENDED"');
    expect(authority).toContain('"FREE_SUPPORT_ENDED"');
    expect(authority).toContain('"LICENSE_RENEWAL_REQUIRED"');
  });

  it("requires recent admin and same-origin for publish or withdraw", () => {
    const route = source("app/api/admin/product-broadcasts/route.ts");
    expect(route).toContain("assertSameOrigin(request)");
    expect(route).toContain("requireRecentAdmin()");
    expect(route).toContain('z.literal("PUBLISH")');
    expect(route).toContain('z.literal("WITHDRAW")');
  });

  it("returns typed codes to the Agent without remote presentation text", () => {
    const route = source("app/api/licensing-agent/notifications/route.ts");
    expect(route).toContain('capabilityId: "bke.product-broadcasts"');
    expect(route).toContain("code: broadcast.code");
    expect(route).not.toMatch(/title\s*:/);
    expect(route).not.toMatch(/body\s*:/);
  });

  it("uses a reserved persisted namespace without a new Prisma model", () => {
    const authority = source("platform/notifications/product-broadcasts.ts");
    expect(authority).toContain('const BROADCAST_GROUP = "product-broadcasts"');
    expect(authority).toContain('const BROADCAST_KEY_PREFIX = "product-broadcast:"');
    expect(authority).toContain('INSERT INTO "SiteContent"');
  });

  it("creates a fresh campaign identifier whenever a code is republished", () => {
    const authority = source("platform/notifications/product-broadcasts.ts");
    expect(authority).toContain("broadcastId: randomUUID()");
    expect(authority).toContain("ON CONFLICT (\"key\") DO UPDATE");
  });
});
