import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("trusted key discovery and release UI", () => {
  it("exposes the Agent-compatible root route without authentication", () => {
    const route = readFileSync("app/keys/route.ts", "utf8");
    expect(route).toContain("@/app/api/licensing/keys/route");
    const source = readFileSync("app/api/licensing/keys/route.ts", "utf8");
    expect(source).toContain("keys:");
    expect(source).toContain("key_id");
    expect(source).toContain("public_key");
    expect(source).toContain('algorithm: "Ed25519"');
    expect(source).toContain('status === "ACTIVE"');
    expect(source).toContain("INVALID_SIGNING_KEY_REGISTRY");
    expect(source).not.toContain("privateKeyReference");
  });
  it("keeps automated evidence primary and manual recovery secondary", () => {
    const controls = readFileSync("components/release-evidence-controls.tsx", "utf8");
    expect(controls).toContain("Automated release evidence");
    expect(controls).toContain("Manual fallback / emergency recovery");
    expect(controls).toContain("Awaiting human approval");
    expect(controls).toContain("does not constitute compliance approval");
    expect(controls).not.toContain("Upload SBOM");
  });
});
