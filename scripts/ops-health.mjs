const target = process.argv[2];
if (!target || !/^https:\/\//i.test(target)) {
  console.error("Usage: npm run ops:health -- https://production-host");
  process.exit(2);
}
for (const path of ["/api/health/live", "/api/health/ready"]) {
  const response = await fetch(new URL(path, target), { redirect: "error" });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  const body = await response.json();
  if (body.status !== "ok" && body.status !== "healthy") throw new Error(`${path} returned an unexpected status`);
  console.log(`${path}: ${response.status} (${body.status})`);
}
console.log("Production health checks passed.");
