import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const MAX_WORKER_BYTES = 64 * 1024 * 1024;

// Match pinned Wrangler's upload measurement: sum module Blob sizes, excluding
// source maps and string metadata. Never print bindings or module contents.
// Upstream: cloudflare/workers-sdk packages/deploy-helpers/src/startup-profile.ts
export async function inspectWorkerUpload(bytes) {
  const end = bytes.indexOf(10);
  assert.ok(end > 2 && bytes.subarray(0, 2).toString() === "--", "Invalid Worker upload");
  const boundary = bytes.subarray(2, end).toString("utf8").trim();
  assert.match(boundary, /^[A-Za-z0-9'()+_,.\/:=? -]+$/, "Invalid multipart boundary");
  const upload = await new Response(bytes, {
    headers: { "content-type": "multipart/form-data; boundary=" + boundary },
  }).formData();
  const metadata = JSON.parse(String(upload.get("metadata")));
  assert.equal(typeof metadata.main_module, "string", "Missing module Worker metadata");
  assert.ok(upload.get(metadata.main_module) instanceof Blob, "Missing entry module");
  const modules = [...upload.entries()]
    .filter(([, value]) => value instanceof Blob && value.type !== "application/source-map")
    .map(([name, value]) => ({ name, bytes: value.size, type: value.type }));
  return {
    bytes: modules.reduce((total, item) => total + item.bytes, 0),
    limitBytes: MAX_WORKER_BYTES,
    moduleCount: modules.length,
    largestModules: modules.sort((a, b) => b.bytes - a.bytes).slice(0, 20),
  };
}

export function requireWorkerSize(bytes) {
  assert.ok(Number.isSafeInteger(bytes) && bytes > 0, "Invalid Worker module size");
  assert.ok(bytes <= MAX_WORKER_BYTES,
    "WORKER_BUNDLE_TOO_LARGE: " + bytes + " bytes exceeds " + MAX_WORKER_BYTES);
}

async function reportInputs(path) {
  let text;
  try { text = await readFile(path, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  const meta = JSON.parse(text);
  const totals = new Map();
  for (const output of Object.values(meta.outputs ?? {})) {
    for (const [name, item] of Object.entries(output.inputs ?? {})) {
      totals.set(name, (totals.get(name) ?? 0) + item.bytesInOutput);
    }
  }
  console.log(JSON.stringify({ metadataFile: path, largestInputs:
    [...totals].map(([name, bytes]) => ({ name, bytes }))
      .sort((a, b) => b.bytes - a.bytes).slice(0, 20) }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const summary = await inspectWorkerUpload(await readFile(process.argv[2]));
  console.log(JSON.stringify({ source: process.env.SOURCE_SHA, ...summary }));
  await reportInputs(".workers-build/wrangler-meta.json");
  await reportInputs(".open-next/server-functions/default/handler.mjs.meta.json");
  requireWorkerSize(summary.bytes);
  console.log("PASS: Worker uncompressed bundle fits the documented 64 MiB limit");
}
