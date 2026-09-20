import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const exec = promisify(execFile);

describe("supply-chain generators", () => {
  it("reports the exact bytes written by the SBOM generator", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bke-sbom-"));
    const output = join(directory, "sbom.json");
    try {
      const result = await exec("node", ["scripts/generate-sbom.mjs"], { env: { ...process.env, SBOM_OUTPUT: output, RELEASE_VERSION: "test" } });
      const report = JSON.parse(result.stdout.trim()) as { sha256: string };
      const bytes = await readFile(output);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(report.sha256);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
