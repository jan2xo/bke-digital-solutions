import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

const script = readFileSync("scripts/minio-init.sh", "utf8");
const minioImage = "minio/minio:RELEASE.2025-04-22T22-12-26Z@sha256:a1ea29fa28355559ef137d71fc570e508a214ec84ff8083e39bc5428980b015e";
const mcImage = "minio/mc:RELEASE.2025-04-16T18-13-26Z@sha256:aead63c77f9db9107f1696fb08ecb0faeda23729cde94b0f663edf4fe09728e3";

function docker(args: string[], options: { allowFailure?: boolean } = {}) {
  const result = spawnSync("docker", args, { encoding: "utf8", timeout: 15_000 });
  if (!options.allowFailure && result.status !== 0) throw new Error(result.stderr || `docker ${args[0]} failed`);
  return result;
}

function isolatedRuntime() {
  const suffix = randomBytes(6).toString("hex");
  const network = `bke-minio-test-${suffix}`;
  const container = `bke-minio-test-${suffix}`;
  const bucket = `bke-test-${suffix}`;
  const user = `bke-app-${suffix}`;
  const password = `app-secret-${suffix}-long-enough`;
  const rootUser = `root-${suffix}`;
  const rootPassword = `root-secret-${suffix}-long-enough`;
  docker(["network", "create", network]);
  docker(["run", "-d", "--name", container, "--network", network, "--network-alias", "minio", "-e", `MINIO_ROOT_USER=${rootUser}`, "-e", `MINIO_ROOT_PASSWORD=${rootPassword}`, minioImage, "server", "/data"]);

  const runMc = (args: string[], allowFailure = false) => docker(["run", "--rm", "--network", network, "--entrypoint", "/bin/sh", mcImage, "-c", args.join(" ")], { allowFailure });
  const runInitializer = () => docker(["run", "--rm", "--network", network, "-v", `${process.cwd()}/scripts/minio-init.sh:/usr/local/bin/minio-init.sh:ro`, "-e", `MINIO_ROOT_USER=${rootUser}`, "-e", `MINIO_ROOT_PASSWORD=${rootPassword}`, "-e", "S3_ENDPOINT=http://minio:9000", "-e", "S3_REGION=auto", "-e", `S3_BUCKET=${bucket}`, "-e", `S3_ACCESS_KEY_ID=${user}`, "-e", `S3_SECRET_ACCESS_KEY=${password}`, "-e", "S3_FORCE_PATH_STYLE=true", "-e", "DEPLOYMENT_ENV=production", "--entrypoint", "/bin/sh", mcImage, "/usr/local/bin/minio-init.sh"], { allowFailure: true });
  const cleanup = () => {
    docker(["rm", "-f", container], { allowFailure: true });
    docker(["network", "rm", network], { allowFailure: true });
  };
  return { bucket, user, password, runMc, runInitializer, cleanup, rootUser, rootPassword, container };
}

function mc(runtime: ReturnType<typeof isolatedRuntime>, args: string[], allowFailure = false) {
  const command = `mc alias set local http://${runtime.container}:9000 ${runtime.rootUser} ${runtime.rootPassword} >/dev/null && mc ${args.join(" ")}`;
  return runtime.runMc([command], allowFailure);
}

function waitForMinio(runtime: ReturnType<typeof isolatedRuntime>) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (mc(runtime, ["admin", "info", "local"], true).status === 0) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  throw new Error("isolated MinIO did not become ready");
}

describe("production MinIO bootstrap contract", () => {
  it("uses bounded retries and bucket-scoped permissions", () => {
    expect(script).toContain("max_attempts=30");
    expect(script).toContain("MinIO initialization failed");
    expect(script).toContain("s3:GetBucketLocation");
    expect(script).toContain("s3:ListBucket");
    expect(script).toContain("s3:GetObject");
    expect(script).toContain("s3:PutObject");
    expect(script).toContain("s3:DeleteObject");
    expect(script).toContain("mc anonymous set none");
    expect(script).toContain("mc admin policy entities local --user");
    expect(script).toContain("mc admin group list local --json");
    expect(script).toContain("unintended direct policy access");
    expect(script).toContain("authorization-bearing group");
  });

  it("keeps the production storage topology and credential boundary", () => {
    const resolved: { services: Record<string, { depends_on?: Record<string, { condition: string }>; environment?: Record<string, string | null>; ports?: unknown[]; volumes?: Array<{ type?: string; source?: string; target?: string }> }> } = JSON.parse(execFileSync("docker", ["compose", "--env-file", ".env.production.example", "-f", "docker-compose.production.yml", "config", "--format", "json"], { encoding: "utf8" }));
    const services = resolved.services;
    expect(services.minio).toBeDefined();
    expect(services["minio-init"]?.depends_on?.minio?.condition).toBe("service_healthy");
    expect(services.app.depends_on?.["minio-init"]?.condition).toBe("service_completed_successfully");
    expect(services["backup-worker"].depends_on?.["minio-init"]?.condition).toBe("service_completed_successfully");
    expect(services.minio.ports ?? []).toHaveLength(0);
    expect(services.minio.volumes?.some((volume) => volume.type === "volume" && volume.source === "object_data" && volume.target === "/data")).toBe(true);
    for (const name of ["app", "scheduler", "backup-worker", "caddy", "postgres", "valkey"]) {
      expect(services[name].environment?.MINIO_ROOT_USER ?? null).toBeNull();
      expect(services[name].environment?.MINIO_ROOT_PASSWORD ?? null).toBeNull();
    }
    expect(services.minio.environment?.MINIO_ROOT_USER).toBeTruthy();
    expect(services.minio.environment?.MINIO_ROOT_PASSWORD).toBeTruthy();
    expect(services["minio-init"].environment?.MINIO_ROOT_USER).toBeTruthy();
    expect(services["minio-init"].environment?.MINIO_ROOT_PASSWORD).toBeTruthy();
    expect(services["minio-init"].environment?.S3_ACCESS_KEY_ID).toBeTruthy();
    expect(services["minio-init"].environment?.S3_SECRET_ACCESS_KEY).toBeTruthy();
    expect(services.app.environment?.S3_ACCESS_KEY_ID).toBeTruthy();
    expect(services.app.environment?.S3_SECRET_ACCESS_KEY).toBeTruthy();
    expect(services["backup-worker"].environment?.S3_ACCESS_KEY_ID).toBeTruthy();
    expect(services["backup-worker"].environment?.S3_SECRET_ACCESS_KEY).toBeTruthy();
  });
});

describe("live MinIO bootstrap integration", () => {
  it("executes clean bootstrap and converges on an idempotent rerun", () => {
    const runtime = isolatedRuntime();
    try {
      waitForMinio(runtime);
      const first = runtime.runInitializer();
      expect(first.status, first.stderr).toBe(0);
      const second = runtime.runInitializer();
      expect(second.status, second.stderr).toBe(0);
      expect(mc(runtime, ["ls", `local/${runtime.bucket}`]).status).toBe(0);
      expect(mc(runtime, ["anonymous", "get", `local/${runtime.bucket}`]).stdout.trim()).toContain("private");
      expect(mc(runtime, ["admin", "user", "info", "local", runtime.user]).status).toBe(0);
      expect(mc(runtime, ["admin", "policy", "entities", "local", "--user", runtime.user, "--json"]).stdout).toContain('"policies":["bke-app-storage"]');
    } finally {
      runtime.cleanup();
    }
  }, 120_000);

  it("fails closed when a broader direct policy is present", () => {
    const runtime = isolatedRuntime();
    try {
      waitForMinio(runtime);
      expect(runtime.runInitializer().status).toBe(0);
      expect(mc(runtime, ["admin", "policy", "attach", "local", "readwrite", "--user", runtime.user]).status).toBe(0);
      const result = runtime.runInitializer();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("unintended direct policy access");
      expect(result.stdout).not.toContain(runtime.password);
      expect(result.stderr).not.toContain(runtime.password);
    } finally {
      runtime.cleanup();
    }
  }, 120_000);

  it("fails closed when the application identity has group authorization", () => {
    const runtime = isolatedRuntime();
    const group = `bke-group-${randomBytes(5).toString("hex")}`;
    const unrelated = `bke-unrelated-${randomBytes(5).toString("hex")}`;
    try {
      waitForMinio(runtime);
      expect(runtime.runInitializer().status).toBe(0);
      expect(mc(runtime, ["admin", "user", "add", "local", unrelated, `unrelated-secret-${randomBytes(5).toString("hex")}`]).status).toBe(0);
      expect(mc(runtime, ["admin", "group", "add", "local", group, runtime.user]).status).toBe(0);
      expect(mc(runtime, ["admin", "policy", "attach", "local", "readwrite", "--group", group]).status).toBe(0);
      const result = runtime.runInitializer();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("authorization-bearing group");
      expect(result.stdout).not.toContain(runtime.password);
      expect(result.stderr).not.toContain(runtime.password);
      expect(mc(runtime, ["admin", "user", "info", "local", unrelated]).status).toBe(0);
    } finally {
      runtime.cleanup();
    }
  }, 120_000);
});
