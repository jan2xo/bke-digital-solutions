import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("licensing identity remains independent of retired Supply Chain UI", () => {
  it("preserves public Agent-compatible active licensing key discovery without private keys", () => {
    const route = readFileSync("app/keys/route.ts", "utf8");
    expect(route).toContain("@/app/api/licensing/keys/route");
    const source = readFileSync("app/api/licensing/keys/route.ts", "utf8");
    expect(source).toContain("keys:");
    expect(source).toContain("key_id");
    expect(source).toContain("public_key");
    expect(source).toContain('key.algorithm === "Ed25519"');
    expect(source).toContain('status === "ACTIVE"');
    expect(source).toContain("INVALID_SIGNING_KEY_REGISTRY");
    expect(source).not.toContain("privateKeyReference");
  });
  it("retains licensing controls while release detail uses the exact GitHub tag", () => {
    const source = readFileSync("app/admin/releases/[id]/page.tsx", "utf8");
    expect(source).toContain("githubVersionReleaseUrl(version.product.productId, version.version)");
    expect(source).toContain("Enable for Licensing");
    expect(source).toContain("Disable for Licensing");
    expect(source).not.toContain("ReleaseEvidenceControls");
  });
});
