import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const schemaPath = "prisma/schema.prisma";
const generatedPath = "platform/persistence/generated/prisma";
const temporarySchema = ".workers-build/schema.prisma";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Workers build command failed: " + command + " (exit " + result.status + ")");
}
async function snapshot(directory) {
  const result = {};
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(result, await snapshot(path));
    else if (entry.isFile()) result[path] = createHash("sha256").update(await readFile(path)).digest("hex");
    else throw new Error("Unexpected generated-client entry");
  }
  return result;
}

const canonical = await readFile(schemaPath, "utf8");
const generators = [...canonical.matchAll(/^generator client \{[\s\S]*?^\}/gm)];
assert.equal(generators.length, 1, "Expected the one canonical client generator");
const generator = generators[0][0];
assert.match(generator, /provider\s*=\s*"prisma-client"/);
assert.match(generator, /output\s*=\s*"\.\.\/platform\/persistence\/generated\/prisma"/);
assert.doesNotMatch(generator, /^\s*runtime\s*=/m, "Review an explicitly configured runtime before deriving a build");
const workerdGenerator = generator.replace(/\n\}$/, '\n  runtime = "workerd"\n}');
const derived = canonical.replace(generator, workerdGenerator);
assert.equal(derived.replace(workerdGenerator, ""), canonical.replace(generator, ""), "Data model must remain identical");
const original = await snapshot(generatedPath);
await mkdir(".workers-build", { recursive: true });
await writeFile(temporarySchema, derived, { flag: "wx" });

try {
  // Only generator input differs; no database command or schema/history write.
  run(process.execPath, ["node_modules/prisma/build/index.js", "generate", "--schema", temporarySchema]);
  const compiler = await readFile(join(generatedPath, "internal/class.ts"), "utf8");
  assert.ok(!compiler.includes("new WebAssembly.Module("), "Dynamic WASM compilation remains in the generated runtime");
  assert.match(compiler, /\.wasm(?!-base64)/, "Expected a statically imported Workers WASM module");
  // The Turbopack WASM resolver expanded to ~60k project files and bundled
  // unrelated database engines. Use Next's supported Webpack build for this
  // target; OpenNext then adapts that output without rebuilding it.
  run(process.execPath, ["node_modules/next/dist/bin/next", "build", "--webpack"]);
  run(process.execPath, ["node_modules/@opennextjs/cloudflare/dist/cli/index.js", "build", "--skipNextBuild"]);
} finally {
  // Restore through the real canonical generator, never by patching output.
  try {
    run("npm", ["run", "db:generate"]);
    assert.equal(await readFile(schemaPath, "utf8"), canonical, "Canonical schema changed");
    assert.deepEqual(await snapshot(generatedPath), original, "Node client was not restored byte-for-byte");
  } finally {
    await rm(temporarySchema, { force: true });
  }
}
