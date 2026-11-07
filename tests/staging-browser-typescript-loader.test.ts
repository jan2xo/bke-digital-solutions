import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const scratchDirs: string[] = [];
afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("Staging browser TypeScript module loader", () => {
  it("loads raw package TypeScript inside node_modules with the existing tsx preload", () => {
    // Simulate the source-exported @bke/identity/contracts/session.contract.ts
    // package layout that Node's built-in strip-types refuses to execute.
    const root = mkdtempSync(join(tmpdir(), "bke-staging-ts-loader-"));
    scratchDirs.push(root);
    const contracts = join(root, "node_modules", "@bke", "identity", "contracts");
    mkdirSync(contracts, { recursive: true });
    const modulePath = join(contracts, "session.contract.ts");
    writeFileSync(modulePath, 'export const fixtureProof: string = "RAW_TS_MODULE_LOADED";\n');
    const probe = spawnSync(process.execPath, [
      "--import=tsx",
      "--input-type=module",
      "--eval",
      'const m = await import(process.argv[1]); if (m.fixtureProof !== "RAW_TS_MODULE_LOADED") process.exit(10);',
      pathToFileURL(modulePath).href,
    ], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_OPTIONS: "" },
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(probe.error).toBeUndefined();
    expect(probe.status, probe.stderr || probe.stdout).toBe(0);
  });
});
