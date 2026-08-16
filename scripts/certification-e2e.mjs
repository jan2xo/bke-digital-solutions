import { spawnSync } from "node:child_process";
import { execFileSync } from "node:child_process";

const run = (args) => {
  const result = spawnSync("npx", ["playwright", "test", ...args], { stdio: "inherit", env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
};
run(["--config=playwright.certification.config.ts", "admin-product.spec.ts", "backups.spec.ts", "commerce.spec.ts", "legal.spec.ts", "provider-settings.spec.ts", "public.spec.ts", "scheduler.spec.ts", "security-dashboard.spec.ts", "phase6-9-organization.spec.ts"]);
run(["--config=playwright.phase4.config.ts", "tests/e2e/phase4-malware.spec.ts"]);
for (let attempt = 0; attempt < 40; attempt += 1) {
  const state = execFileSync("docker", ["inspect", "--format", "{{.State.Health.Status}}", "bke-certification-clamav-1"], { encoding: "utf8" }).trim();
  if (state === "healthy") break;
  if (attempt === 39) throw new Error("Certification ClamAV did not become healthy before Phase 5");
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
execFileSync("docker", ["restart", "bke-certification-app-1"], { stdio: "inherit" });
for (let attempt = 0; attempt < 40; attempt += 1) {
  const state = execFileSync("docker", ["inspect", "--format", "{{.State.Health.Status}}", "bke-certification-app-1"], { encoding: "utf8" }).trim();
  if (state === "healthy") break;
  if (attempt === 39) throw new Error("Certification app did not become healthy before Phase 5");
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
run(["--config=playwright.phase5.config.ts", "tests/e2e/phase5-control-plane.spec.ts", "--grep-invert", "scanner page reports"]);

const scannerTest = (expected) => {
  const env = { ...process.env, PHASE5_SCANNER_EXPECTED: expected };
  const result = spawnSync("npx", ["playwright", "test", "--config=playwright.phase5.config.ts", "tests/e2e/phase5-control-plane.spec.ts", "--grep", "scanner page reports"], { stdio: "inherit", env });
  return result.status === 0;
};

const waitForAppScannerConnection = async () => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      execFileSync("docker", ["exec", "bke-certification-app-1", "node", "-e", "const net=require('node:net');const s=net.connect(3310,'clamav',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),1000)"], { stdio: "ignore" });
      return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Certification app cannot connect to ClamAV on clamav:3310");
};

if (!scannerTest("HEALTHY")) throw new Error("Certification scanner HEALTHY probe failed before outage test");
execFileSync("docker", ["stop", "bke-certification-clamav-1"], { stdio: "inherit" });
try {
  if (!scannerTest("UNAVAILABLE")) throw new Error("Certification scanner UNAVAILABLE probe failed");
} finally {
  execFileSync("docker", ["start", "bke-certification-clamav-1"], { stdio: "inherit" });
}
for (let attempt = 0; attempt < 40; attempt += 1) {
  const state = execFileSync("docker", ["inspect", "--format", "{{.State.Health.Status}}", "bke-certification-clamav-1"], { encoding: "utf8" }).trim();
  if (state === "healthy") break;
  if (attempt === 39) throw new Error("Certification ClamAV did not become healthy after restore");
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
execFileSync("docker", ["restart", "bke-certification-app-1"], { stdio: "inherit" });
for (let attempt = 0; attempt < 40; attempt += 1) {
  const state = execFileSync("docker", ["inspect", "--format", "{{.State.Health.Status}}", "bke-certification-app-1"], { encoding: "utf8" }).trim();
  if (state === "healthy") break;
  if (attempt === 39) throw new Error("Certification app did not become healthy after scanner restore");
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
await waitForAppScannerConnection();
let healthy = false;
for (let attempt = 0; attempt < 3 && !healthy; attempt += 1) {
  healthy = scannerTest("HEALTHY");
}
if (!healthy) throw new Error("Certification scanner HEALTHY probe failed after readiness checks");
