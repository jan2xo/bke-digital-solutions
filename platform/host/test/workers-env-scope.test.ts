import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const keys = [
  "BKE_RUNTIME",
  "NODE_ENV",
  "DEPLOYMENT_ENV",
  "APP_URL",
  "DATABASE_URL",
  "DIRECT_DATABASE_URL",
  "SESSION_SECRET",
  "LICENSE_PEPPER",
  "CRON_SECRET",
  "S3_BUCKET",
  "EMAIL_FROM",
] as const;
const original = new Map(keys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of keys) {
    const value = original.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
});

function configureWorkersWithoutDatabaseUrl() {
  process.env.BKE_RUNTIME = "workers";
  process.env.NODE_ENV = "test";
  process.env.DEPLOYMENT_ENV = "test";
  process.env.APP_URL = "https://workers-ci.example.invalid";
  process.env.SESSION_SECRET = "ci-session-secret-with-at-least-32-chars";
  process.env.LICENSE_PEPPER = "ci-license-pepper-with-at-least-32-chars";
  process.env.CRON_SECRET = "ci-cron-secret-with-at-least-32-chars";
  process.env.S3_BUCKET = "ci-private";
  process.env.EMAIL_FROM = "build@example.invalid";
  delete process.env.DATABASE_URL;
  delete process.env.DIRECT_DATABASE_URL;
}

describe("Workers runtime environment scope", () => {
  it("defers Workers configuration until an operation supplies Hyperdrive", async () => {
    configureWorkersWithoutDatabaseUrl();
    const { env, getRuntimeEnvironment } = await import("@/platform/host/env");

    expect(() => env.APP_URL).toThrow("WORKER_OPERATION_SCOPE_REQUIRED");

    const scope = await import("@/platform/host/operation-scope");
    const pending: Promise<unknown>[] = [];
    const bindingUrl = "postgresql://worker:secret@hyperdrive.invalid:5432/bke_staging";
    const response = await scope.withOperationResponse(
      bindingUrl,
      async () => {
        expect(env.DATABASE_URL).toBe(bindingUrl);
        expect(getRuntimeEnvironment().DATABASE_URL).toBe(bindingUrl);
        expect(Object.keys(env)).toContain("DATABASE_URL");
        expect("APP_URL" in env).toBe(true);
        return new Response(null);
      },
      (promise) => pending.push(promise),
    );

    expect(response.status).toBe(200);
    await Promise.all(pending);
    expect(() => env.DATABASE_URL).toThrow("WORKER_OPERATION_SCOPE_REQUIRED");
  });

  it("keeps Node configuration eagerly available without an operation scope", async () => {
    process.env.BKE_RUNTIME = "node";
    process.env.NODE_ENV = "test";
    process.env.DEPLOYMENT_ENV = "test";
    process.env.APP_URL = "https://node-ci.example.invalid";
    process.env.DATABASE_URL = "postgresql://node:secret@localhost:5432/bke_test";
    process.env.SESSION_SECRET = "ci-session-secret-with-at-least-32-chars";
    process.env.LICENSE_PEPPER = "ci-license-pepper-with-at-least-32-chars";
    process.env.CRON_SECRET = "ci-cron-secret-with-at-least-32-chars";
    process.env.S3_BUCKET = "ci-private";
    process.env.EMAIL_FROM = "build@example.invalid";
    const { env } = await import("@/platform/host/env");

    expect(env.DATABASE_URL).toBe(process.env.DATABASE_URL);
    expect(Object.keys(env)).toContain("DATABASE_URL");
  });
});
