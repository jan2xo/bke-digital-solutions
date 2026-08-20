import { readFile } from "node:fs/promises";

const manifestPath = ".next/server/app-paths-manifest.json";
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const required = [
  "/api/admin/supply-chain/route",
  "/api/admin/artifacts/[id]/route",
];
const missing = required.filter((route) => !manifest[route]);
if (missing.length > 0) {
  throw new Error(`Production build is missing required admin routes: ${missing.join(", ")}`);
}
console.log(`Production build contains ${required.length} required admin mutation routes.`);
