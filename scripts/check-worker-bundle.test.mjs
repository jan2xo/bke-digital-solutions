import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectWorkerUpload, MAX_WORKER_BYTES, requireWorkerSize } from "./check-worker-bundle.mjs";

test("counts uploaded code/WASM and excludes metadata/source maps", async () => {
  const form = new FormData();
  form.set("metadata", JSON.stringify({ main_module: "worker.js", bindings: [
    { type: "plain_text", name: "PRIVATE_FIXTURE", text: "not-printed" },
  ] }));
  form.set("worker.js", new Blob(["export default {};"], { type: "application/javascript+module" }), "worker.js");
  form.set("compiler.wasm", new Blob([new Uint8Array([0, 97, 115, 109])], { type: "application/wasm" }), "compiler.wasm");
  form.set("worker.js.map", new Blob(["ignored".repeat(100)], { type: "application/source-map" }), "worker.js.map");
  const response = new Response(form);
  const report = await inspectWorkerUpload(Buffer.from(await response.arrayBuffer()));
  assert.equal(report.bytes, Buffer.byteLength("export default {};") + 4);
  assert.equal(report.moduleCount, 2);
  assert.ok(!JSON.stringify(report).includes("PRIVATE_FIXTURE"));
  assert.ok(!JSON.stringify(report).includes("not-printed"));
  requireWorkerSize(report.bytes);
});

test("accepts exact platform boundary and rejects oversized or invalid measurements", () => {
  requireWorkerSize(MAX_WORKER_BYTES);
  assert.throws(() => requireWorkerSize(MAX_WORKER_BYTES + 1), /WORKER_BUNDLE_TOO_LARGE/);
  for (const invalid of [0, -1, NaN, Infinity, 1.5]) {
    assert.throws(() => requireWorkerSize(invalid), /Invalid Worker module size/);
  }
});

test("rejects an upload without the declared entry module", async () => {
  const form = new FormData();
  form.set("metadata", JSON.stringify({ main_module: "missing.js" }));
  const response = new Response(form);
  await assert.rejects(inspectWorkerUpload(Buffer.from(await response.arrayBuffer())), /Missing entry module/);
});
