import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const wrapper = readFileSync("bke.sh", "utf8");
const ops = readFileSync("scripts/v3-ops.sh", "utf8");
const deploy = readFileSync("scripts/deploy-production.sh", "utf8");

describe("V3 Bash operator contract", () => {
  it("exposes one top-level operator entrypoint", () => {
    expect(wrapper).toContain('scripts/v3-ops.sh');
    expect(wrapper).toContain('exec bash');
  });

  it("uses .env as the only runtime environment file", () => {
    expect(ops).toContain('ENV_FILE="$ROOT_DIR/.env"');
    expect(ops).toContain('ENV_TEMPLATE="$ROOT_DIR/.env.example"');
    expect(ops).not.toContain(".env.production");
    expect(ops).not.toContain(".env.vps");
  });

  it("covers the normal VPS lifecycle without hand-written compose commands", () => {
    for (const command of [
      "setup", "env", "validate", "build", "migrate", "start", "deploy",
      "update", "status", "logs", "restart", "stop", "health", "doctor",
    ]) {
      expect(ops).toContain(command);
    }
    expect(ops).toContain("git pull --ff-only origin main");
    expect(ops).toContain('compose --profile operations run --rm migrate');
    expect(ops).toContain('compose up -d app scheduler backup-worker caddy');
  });

  it("keeps destructive volume deletion out of the operator", () => {
    expect(ops).toContain("compose down");
    expect(ops).not.toContain("--volumes");
    expect(ops).not.toContain("prisma migrate dev");
    expect(ops).not.toContain("git reset --hard");
    expect(ops).not.toContain("git push --force");
  });

  it("allows deploy health verification to come from APP_URL", () => {
    expect(ops).toContain("read_env_value APP_URL");
    expect(ops).toContain('BKE_HEALTH_URL="$url" bash "$ROOT_DIR/scripts/deploy-production.sh"');
    expect(deploy).toContain('BKE_HEALTH_URL');
  });
});
