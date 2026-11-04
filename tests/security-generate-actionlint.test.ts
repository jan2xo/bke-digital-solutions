import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("candidate exact-head GitHub Actions lint", () => {
  it("runs pinned actionlint against both trusted workflow files in this checkout", () => {
    expect(() =>
      execFileSync(
        "go",
        [
          "run",
          "github.com/rhysd/actionlint/cmd/actionlint@v1.7.7",
          ".github/workflows/ci.yml",
          ".github/workflows/security-generate.yml",
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          stdio: "pipe",
          timeout: 180_000,
        },
      ),
    ).not.toThrow();
  }, 120_000);
});
