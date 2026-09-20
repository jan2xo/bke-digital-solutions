import { mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { join } from "node:path";

const version = process.argv[2] ?? process.env.RELEASE_VERSION;
if (!version || !/^[A-Za-z0-9._-]{1,128}$/.test(version)) {
  console.error("Usage: npm run supplychain:evidence -- <release-version> [output-directory]");
  process.exit(2);
}
const outputDirectory = process.argv[3] ?? join(".supply-chain", version);
await mkdir(outputDirectory, { recursive: true });

function run(script, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { stdio: "inherit", env: { ...process.env, RELEASE_VERSION: version, ...environment } });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${script} exited with ${code}`)));
  });
}

const sbom = join(outputDirectory, "sbom.cdx.json");
const provenance = join(outputDirectory, "provenance.json");
await run("scripts/generate-sbom.mjs", { SBOM_OUTPUT: sbom });
await run("scripts/generate-provenance.mjs", { PROVENANCE_OUTPUT: provenance });
const [sbomBytes, provenanceBytes] = await Promise.all([readFile(sbom), readFile(provenance)]);
console.log(JSON.stringify({ version, outputDirectory, sbom: { path: sbom, sha256: createHash("sha256").update(sbomBytes).digest("hex"), bytes: sbomBytes.length }, provenance: { path: provenance, sha256: createHash("sha256").update(provenanceBytes).digest("hex"), bytes: provenanceBytes.length } }));
