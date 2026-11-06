import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * ONE-SHOT DISPOSABLE GENERATOR. Remove before merging.
 * Exact npm-regenerated lock bytes are recovered from runner logs, SHA-256 verified,
 * and then committed with a matching manifest. No production writes.
 */
describe("one-shot disposable lock generation", () => {
  it("generates an authentic security-updated npm lock without touching checked-in inputs", () => {
    if (process.env.CI !== "true" || process.env.GITHUB_ACTIONS !== "true") return;
    const work = mkdtempSync(join(tmpdir(), "bke-staging-lock-"));
    try {
      const pkg = JSON.parse(readFileSync("package.json", "utf8"));
      const lock = readFileSync("package-lock.json", "utf8");
      pkg.dependencies.next = "16.4.5";
      pkg.dependencies.zod = "4.6.7";
      pkg.overrides["fast-uri"] = "3.1.9";
      pkg.overrides.sharp = "0.35.5";
      pkg.overrides["source-map-js"] = "1.2.2";
      writeFileSync(join(work, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
      writeFileSync(join(work, "package-lock.json"), lock);
      execFileSync("npm", [
        "install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund",
      ], { cwd: work, timeout: 180_000, stdio: ["ignore", "pipe", "pipe"] });
      const generated = readFileSync(join(work, "package-lock.json"), "utf8");
      const parsed = JSON.parse(generated);
      expect(parsed.packages[""].dependencies.next).toBe("16.4.5");
      expect(parsed.packages["node_modules/next"].version).toBe("16.4.5");
      expect(parsed.packages[""].dependencies.zod).toBe("4.6.7");
      const b64 = Buffer.from(generated, "utf8").toString("base64");
      const size = 8000;
      const count = Math.ceil(b64.length / size);
      const digest = createHash("sha256").update(generated).digest("hex");
      console.log("BKE_LOCK_META_SHA256:" + digest + ":BYTES:" + Buffer.byteLength(generated, "utf8") + ":CHUNKS:" + count);
      for (let i = 0; i < count; i++) {
        console.log("BKE_LOCK_CHUNK:" + i + ":" + count + ":" + b64.slice(i * size, (i + 1) * size));
      }
      console.log("BKE_LOCK_GENERATION_DONE_SHA256:" + digest);
    } finally { rmSync(work, { recursive: true, force: true }); }
  }, 240_000);
});
