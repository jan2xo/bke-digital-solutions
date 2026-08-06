import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const components = Object.entries(lock.packages ?? {}).filter(([name]) => name && name !== "").map(([name, item]) => ({ type: "library", name: name.replace(/^node_modules\//, ""), version: item.version ?? "unknown", purl: item.version ? `pkg:npm/${name.replace(/^node_modules\//, "") }@${item.version}` : undefined }));
const bom = { bomFormat: "CycloneDX", specVersion: "1.5", version: 1, metadata: { timestamp: new Date().toISOString(), component: { type: "application", name: "bke-digital-solutions", version: process.env.RELEASE_VERSION ?? "unreleased" } }, components };
await mkdir(".supply-chain", { recursive: true });
const output = process.env.SBOM_OUTPUT ?? ".supply-chain/sbom.cdx.json";
await writeFile(output, JSON.stringify(bom, null, 2) + "\n");
console.log(JSON.stringify({ output, sha256: createHash("sha256").update(JSON.stringify(bom)).digest("hex"), components: components.length }));
