import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const SOURCE_REPO = "jan2xo/bke-command-center";
const SOURCE_COMMIT = "e8b37b1895c53a7cbafd6621119891e59a19cdc7";
const CANONICAL_BLOB_SHA = "38496917a801a50404a0f9fc5d7ef298dcf445a7";

describe("BKE root engineering authority bootstrap", () => {
  it("pins the exact canonical Command Center root bke.md bytes", () => {
    const bytes = readFileSync("bke.md");
    const header = Buffer.from(`blob ${bytes.length}\0`);
    const sha = createHash("sha1").update(header).update(bytes).digest("hex");
    expect(sha).toBe(CANONICAL_BLOB_SHA);
    expect(SOURCE_REPO).toBe("jan2xo/bke-command-center");
    expect(SOURCE_COMMIT).toMatch(/^[a-f0-9]{40}$/);
  });

  it("declares PR-owned intentional CI without granting privileged execution", () => {
    const text = readFileSync("bke.md", "utf8");
    expect(text).toContain("## 7. Intentional CI — PR-owned plans, stable trust");
    expect(text).toContain("Default-branch entrypoints are routing infrastructure, not test authority.");
    expect(text).toContain("Branch-authored tests must not receive secrets");
    expect(text).toContain("Exact-head certification");
    expect(text).toContain("Retire disposable CI");
    expect(text).toContain("jan2xo/bke-command-center/bke.md");
  });
});
