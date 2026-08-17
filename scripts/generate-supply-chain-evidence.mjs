import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

const versionId = process.argv[2];
if (!versionId || !/^[A-Za-z0-9._-]{1,128}$/.test(versionId)) {
  console.error("Usage: npm run supplychain:generate -- <version-id> [output-directory]");
  process.exit(2);
}
const outputDirectory = process.argv[3] ?? join(".supply-chain", versionId);
await mkdir(outputDirectory, { recursive: true });

function run(command, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve(stdout) : reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}: ${stderr.replace(/(?:postgres(?:ql)?:\/\/)[^\s]+/gi, "[redacted-connection]").slice(-2000)}`)));
  });
}

async function digest(path) {
  const bytes = await readFile(path);
  return { path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

const sbom = join(outputDirectory, "sbom.cdx.json");
const provenance = join(outputDirectory, "provenance.json");
const dependencies = join(outputDirectory, "dependencies.json");
const migration = join(outputDirectory, "migration-status.txt");
try {
  await run(process.execPath, ["scripts/generate-sbom.mjs"], { RELEASE_VERSION: versionId, SBOM_OUTPUT: sbom });
  await run(process.execPath, ["scripts/generate-provenance.mjs"], { RELEASE_VERSION: versionId, PROVENANCE_OUTPUT: provenance });
  await run(process.execPath, ["scripts/generate-dependency-evidence.mjs", versionId, dependencies]);
  const migrationOutput = await run("npx", ["prisma", "migrate", "status"]);
  if (!/database schema is up to date/i.test(migrationOutput)) throw new Error("Migration status did not confirm an up-to-date schema.");
  await writeFile(migration, migrationOutput, { mode: 0o600 });
  const files = await Promise.all([sbom, provenance, dependencies, migration].map(digest));
  console.log(JSON.stringify({ versionId, outputDirectory, files }));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Evidence generation failed.");
  process.exitCode = 1;
}
