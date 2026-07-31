import "dotenv/config";
import { parseEnvironment } from "../lib/config/environment";

const environment = parseEnvironment(process.env);
const target = new URL(process.argv[2] ?? "/api/health/ready", environment.APP_URL);
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 10_000);
try {
  const response = await fetch(target, { signal: controller.signal, redirect: "error" });
  if (!response.ok) throw new Error(`Health check returned HTTP ${response.status}`);
  const body = await response.json() as { status?: string };
  if (!body.status) throw new Error("Health response did not contain a status");
  console.info(`Health check passed: ${target.pathname} (${body.status}).`);
} finally {
  clearTimeout(timeout);
}
