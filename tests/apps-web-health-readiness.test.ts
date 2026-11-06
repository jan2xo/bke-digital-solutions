import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pgQuery: vi.fn(),
  pgEnd: vi.fn(),
  redisConnect: vi.fn(),
  redisPing: vi.fn(),
  redisQuit: vi.fn(),
  s3Send: vi.fn(),
  upstashPing: vi.fn(),
}));

vi.mock("pg", () => ({
  Pool: class {
    query(...args: unknown[]) { return mocks.pgQuery(...args); }
    end() { return mocks.pgEnd(); }
  },
}));
vi.mock("redis", () => ({
  createClient: () => ({
    connect: mocks.redisConnect,
    ping: mocks.redisPing,
    quit: mocks.redisQuit,
    get isOpen() { return true; },
  }),
}));
vi.mock("@upstash/redis", () => ({
  Redis: class { ping() { return mocks.upstashPing(); } },
}));
vi.mock("@aws-sdk/client-s3", () => ({
  HeadBucketCommand: class { constructor(readonly input: unknown) {} },
  S3Client: class { send(...args: unknown[]) { return mocks.s3Send(...args); } },
}));
vi.mock("@/platform/providers", () => ({
  createProviderConfigurationPlatform: vi.fn(),
}));

async function getReadiness() {
  vi.resetModules();
  return (await import("@/apps/web/health/readiness")).readiness;
}

describe("active web readiness storage boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("DATABASE_URL", "postgresql://bke:secret@db.example:5432/bke");
    vi.stubEnv("REDIS_URL", "redis://valkey.example:6379");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    vi.stubEnv("PAYMENT_PROVIDER", "mock");
    vi.stubEnv("EMAIL_PROVIDER", "log");
    for (const name of ["S3_BUCKET", "S3_ENDPOINT", "S3_PUBLIC_UPLOAD_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) {
      vi.stubEnv(name, "");
    }
    mocks.pgQuery.mockResolvedValue([{ value: 1 }]);
    mocks.pgEnd.mockResolvedValue(undefined);
    mocks.redisConnect.mockResolvedValue(undefined);
    mocks.redisPing.mockResolvedValue("PONG");
    mocks.redisQuit.mockResolvedValue(undefined);
    mocks.s3Send.mockResolvedValue(undefined);
    mocks.upstashPing.mockResolvedValue("PONG");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("reports ready without an object-storage probe when S3 is absent", async () => {
    const readiness = await getReadiness();
    const result = await readiness();
    expect(result).toEqual({ ready: true, checks: { postgresql: "up", valkey: "up", providers: "up" } });
    expect(mocks.s3Send).not.toHaveBeenCalled();
  });

  it("emits only fixed Valkey diagnostic enums and preserves down readiness on an authentication error", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://bke-test.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "private-redis-token");
    mocks.upstashPing.mockRejectedValue(new Error("WRONGPASS private-redis-token https://private-endpoint"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const readiness = await getReadiness();
    const result = await readiness();
    expect(result.ready).toBe(false);
    expect(result.checks.valkey).toBe("down");
    const diagnostic = warning.mock.calls.map(([value]) => String(value))
      .find((value) => value.includes('"event":"valkey_probe_failed"'));
    expect(diagnostic).toBe(JSON.stringify({
      event: "valkey_probe_failed",
      dependency: "valkey",
      transport: "upstash",
      reason: "authentication_rejected",
    }));
    expect(diagnostic).not.toContain("private");
    expect(diagnostic).not.toContain("WRONGPASS");
  });

  it("ignores complete stale product S3 settings after product storage retirement", async () => {
    vi.stubEnv("S3_BUCKET", "bke-staging-private");
    vi.stubEnv("S3_ENDPOINT", "https://retired-storage.example");
    vi.stubEnv("S3_PUBLIC_UPLOAD_ENDPOINT", "https://retired-upload.example");
    vi.stubEnv("S3_ACCESS_KEY_ID", "retired-key");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "retired-secret");
    mocks.s3Send.mockRejectedValue(new Error("retired bucket unavailable"));
    const readiness = await getReadiness();
    const result = await readiness();
    expect(result).toEqual({ ready: true, checks: { postgresql: "up", valkey: "up", providers: "up" } });
    expect(mocks.pgQuery).toHaveBeenCalled();
    expect(mocks.redisPing).toHaveBeenCalled();
    expect(mocks.s3Send).not.toHaveBeenCalled();
  });

  it("ignores partial stale product S3 settings without adding an object-storage check", async () => {
    vi.stubEnv("S3_BUCKET", "bke-staging-private");
    const readiness = await getReadiness();
    const result = await readiness();
    expect(result).toEqual({ ready: true, checks: { postgresql: "up", valkey: "up", providers: "up" } });
    expect(mocks.pgQuery).toHaveBeenCalled();
    expect(mocks.redisPing).toHaveBeenCalled();
    expect(mocks.s3Send).not.toHaveBeenCalled();
  });
});
