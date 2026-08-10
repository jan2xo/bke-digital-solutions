import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const command = process.argv[2];
const args = process.argv.slice(3);
if (!command) throw new Error("A command is required");

const values = {};
for (const rawLine of readFileSync(".env.certification", "utf8").split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) continue;
  const separator = line.indexOf("=");
  if (separator > 0) values[line.slice(0, separator)] = line.slice(separator + 1);
}
for (const required of ["DATABASE_URL", "SESSION_SECRET", "LICENSE_PEPPER", "CRON_SECRET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) {
  if (!values[required]) throw new Error(`Missing ${required} in .env.certification`);
}

const database = new URL(values.DATABASE_URL);
database.hostname = "127.0.0.1";
database.port = "55432";
const testEnvironment = {
  ...process.env,
  ...values,
  NODE_ENV: "test",
  DEPLOYMENT_ENV: "test",
  LOCAL_PRODUCTION_SIMULATION: "false",
  APP_URL: "http://127.0.0.1:3000",
  INTERNAL_APP_URL: "",
  PUBLIC_WEBHOOK_ORIGIN: "",
  TRUSTED_ORIGINS: "http://127.0.0.1:3000",
  DATABASE_URL: database.toString(),
  DIRECT_DATABASE_URL: "",
  REDIS_URL: "redis://127.0.0.1:56379",
  S3_ENDPOINT: "http://127.0.0.1:59000",
  PAYMENT_PROVIDER: "mock",
  EMAIL_PROVIDER: "log",
  BKE_DISABLE_EXTERNAL_EMAIL: "true",
};
for (const key of ["PAYMONGO_SECRET_KEY", "PAYMONGO_WEBHOOK_SECRET", "RESEND_API_KEY", "RESEND_SANDBOX_TO"]) delete testEnvironment[key];

let executable = command;
let executableArgs = args;
if (command === "npm" && args[0] === "test") {
  const configPath = join(tmpdir(), `bke-vitest-${process.pid}.config.ts`);
  const vitestConfig = readFileSync("vitest.config.ts", "utf8")
    .replace('import { defineConfig } from "vitest/config";\n', "")
    .replace("defineConfig(", "(")
    .replaceAll('new URL("./",import.meta.url)', 'new URL("file://" + process.cwd() + "/")')
    .replaceAll('new URL("./", import.meta.url)', 'new URL("file://" + process.cwd() + "/")')
    .replaceAll('new URL("./tests/server-only.ts",import.meta.url)', 'new URL("file://" + process.cwd() + "/tests/server-only.ts")');
  writeFileSync(configPath, vitestConfig);
  executable = "npm";
  executableArgs = ["run", "certification:vitest", "--", ...args.slice(1), "--config", configPath];
}
const result = spawnSync(executable, executableArgs, { stdio: "inherit", env: testEnvironment });
process.exit(result.status ?? 1);
