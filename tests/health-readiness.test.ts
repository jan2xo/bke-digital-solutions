import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  environment: { PAYMENT_PROVIDER: "paymongo", EMAIL_PROVIDER: "resend", REDIS_URL: "redis://valkey:6379" },
  query: vi.fn(),
  storage: vi.fn(),
  connect: vi.fn(),
  ping: vi.fn(),
  quit: vi.fn(),
  paymongo: vi.fn(),
  resend: vi.fn(),
}));

vi.mock("@/platform/host/db", () => ({ db: { $queryRaw: mocks.query } }));
vi.mock("@/platform/host/env", () => ({ env: mocks.environment }));
vi.mock("@/lib/storage", () => ({ checkStorageReadiness: mocks.storage }));
vi.mock("@/lib/provider-config/service", () => ({ resolvePayMongoConfiguration: mocks.paymongo, resolveResendConfiguration: mocks.resend }));
vi.mock("@/lib/logger", () => ({ operationalLog: vi.fn() }));
vi.mock("redis", () => ({ createClient: () => ({ connect: mocks.connect, ping: mocks.ping, quit: mocks.quit, get isOpen() { return true; } }) }));
vi.mock("@upstash/redis", () => ({ Redis: class {} }));

describe("runtime readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const name of ["S3_BUCKET", "S3_ENDPOINT", "S3_PUBLIC_UPLOAD_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) Reflect.deleteProperty(mocks.environment, name);
    mocks.query.mockResolvedValue([{ value: 1 }]);
    mocks.storage.mockResolvedValue(undefined);
    mocks.connect.mockResolvedValue(undefined);
    mocks.ping.mockResolvedValue("PONG");
    mocks.quit.mockResolvedValue(undefined);
    mocks.paymongo.mockResolvedValue({ source: "environment" });
    mocks.resend.mockResolvedValue({ source: "environment" });
  });

  it("is ready only when infrastructure and selected provider configuration resolve", async () => {
    const { readiness } = await import("@/lib/health");
    await expect(readiness()).resolves.toEqual({ ready: true, checks: { postgresql: "up", valkey: "up", providers: "up" } });
  });

  it.each([
    ["database", () => mocks.query.mockRejectedValue(new Error("down")), "postgresql"],
    ["Valkey", () => mocks.ping.mockRejectedValue(new Error("down")), "valkey"],
    ["provider configuration", () => mocks.paymongo.mockRejectedValue(new Error("unavailable")), "providers"],
  ])("fails closed when %s is unavailable", async (_label, fail, dependency) => {
    fail();
    const { readiness } = await import("@/lib/health");
    const result = await readiness();
    expect(result.ready).toBe(false);
    expect(result.checks[dependency as keyof typeof result.checks]).toBe("down");
  });
});


it("checks configured legacy storage and fails closed when it is unavailable", async () => {
  Object.assign(mocks.environment, { S3_BUCKET: "legacy-storage", S3_ACCESS_KEY_ID: "key", S3_SECRET_ACCESS_KEY: "secret" });
  mocks.storage.mockRejectedValue(new Error("unavailable"));
  const { readiness } = await import("@/lib/health");
  const result = await readiness();
  expect(result.ready).toBe(false);
  expect(result.checks.objectStorage).toBe("down");
});
