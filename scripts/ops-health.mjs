import { pathToFileURL } from "node:url";

export function validateHealthPayload(path, status, body) {
  const expected = path.endsWith("/live") ? "alive" : "ready";
  if (status !== 200 || body?.status !== expected) return false;
  if (path.endsWith("/ready")) return body.dependencies && Object.values(body.dependencies).every((value) => value === "up");
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = process.argv[2];
  if (!target || !/^https:\/\//i.test(target)) {
    console.error("Usage: npm run ops:health -- https://production-host");
    process.exit(2);
  }
  for (const path of ["/api/health/live", "/api/health/ready"]) {
    const response = await fetch(new URL(path, target), { redirect: "error" });
    const body = await response.json();
    if (!validateHealthPayload(path, response.status, body)) throw new Error(`${path} returned an unexpected health contract or dependency state`);
    console.log(`${path}: ${response.status} (${body.status})`);
  }
  console.log("Production health checks passed.");
}
