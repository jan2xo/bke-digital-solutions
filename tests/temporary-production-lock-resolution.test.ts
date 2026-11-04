import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ENABLED = true;
const PREFIX = "BKE_NPM_LOCK_EMIT_V1";
const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

function emit(name: string, bytes: Buffer): void {
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) throw new Error(`${name} is not valid UTF-8`);
  JSON.parse(text);
  const size = 2400;
  const count = Math.ceil(bytes.length / size);
  console.log(`${PREFIX} BEGIN name=${name} bytes=${bytes.length} sha256=${sha256(bytes)} chunks=${count}`);
  for (let i = 0; i < count; i++) {
    const part = bytes.subarray(i * size, Math.min((i + 1) * size, bytes.length));
    console.log(`${PREFIX} CHUNK name=${name} index=${i + 1}/${count} base64=${part.toString("base64")}`);
  }
  console.log(`${PREFIX} END name=${name} sha256=${sha256(bytes)}`);
}

describe("temporary npm dependency graph resolution emitter", () => {
  it.runIf(ENABLED)("generates and emits the genuine candidate package files", () => {
    const sourceSha = process.env.BKE_EXPECTED_SOURCE_SHA ?? "";
    expect(sourceSha).toMatch(/^[0-9a-f]{40}$/);
    const tmp = mkdtempSync(path.join(os.tmpdir(), "bke-npm-repair-"));
    try {
      const root = process.cwd();
      const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
      const lockBytes = readFileSync(path.join(root, "package-lock.json"));
      const lock = JSON.parse(lockBytes.toString("utf8"));
      expect(pkg.dependencies.next).toBe("16.3.6");
      expect(pkg.dependencies["@prisma/client"]).toBe("7.9.1");
      expect(pkg.dependencies["@prisma/adapter-pg"]).toBe("7.9.1");
      expect(pkg.devDependencies.prisma).toBe("7.9.1");
      expect(pkg.overrides.sharp).toBe("0.35.3");
      expect(pkg.overrides["fast-uri"]).toBe("3.1.5");
      expect(lock.lockfileVersion).toBe(3);
      const versions = { next: "16.4.5", sharp: "0.35.5", prisma: "7.10.1", fastUri: "3.1.9", zod: "4.6.7", sourceMapJs: "1.2.2" };
      pkg.dependencies.next = versions.next;
      pkg.dependencies["@prisma/client"] = versions.prisma;
      pkg.dependencies["@prisma/adapter-pg"] = versions.prisma;
      pkg.devDependencies.prisma = versions.prisma;
      pkg.dependencies.zod = versions.zod;
      pkg.overrides.sharp = versions.sharp;
      pkg.overrides["fast-uri"] = versions.fastUri;
      pkg.overrides["source-map-js"] = versions.sourceMapJs;
      writeFileSync(path.join(tmp, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
      writeFileSync(path.join(tmp, "package-lock.json"), lockBytes);
      const cache = path.join(tmp, ".npm-cache");
      try {
        const output = execFileSync("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund", "--cache", cache], { cwd: tmp, encoding: "utf8", timeout: 240000, maxBuffer: 16777216, env: { ...process.env, npm_config_registry: "https://registry.npmjs.org/" }, stdio: ["ignore", "pipe", "pipe"] });
        console.log(`${PREFIX} NPM_SUCCESS ${output.slice(-1200)}`);
      } catch (error) {
        const e = error as Error & { stderr?: Buffer | string; stdout?: Buffer | string };
        console.error(`${PREFIX} REGISTRY_FAILURE ${[e.message, String(e.stderr ?? ""), String(e.stdout ?? "")].join("\n").slice(-3000)}`);
        throw e;
      }
      const outPkg = readFileSync(path.join(tmp, "package.json"));
      const outLock = readFileSync(path.join(tmp, "package-lock.json"));
      const resolved = JSON.parse(outLock.toString("utf8"));
      expect(resolved.packages[""].dependencies.next).toBe(versions.next);
      expect(resolved.packages[""].dependencies["@prisma/client"]).toBe(versions.prisma);
      expect(resolved.packages[""].dependencies["@prisma/adapter-pg"]).toBe(versions.prisma);
      expect(resolved.packages[""].devDependencies.prisma).toBe(versions.prisma);
      for (const [name, version] of [["next", versions.next], ["sharp", versions.sharp], ["prisma", versions.prisma], ["@prisma/client", versions.prisma], ["@prisma/adapter-pg", versions.prisma], ["fast-uri", versions.fastUri], ["zod", versions.zod], ["source-map-js", versions.sourceMapJs]] as const) {
        const items = Object.entries(resolved.packages as Record<string, { version?: string }>).filter(([key]) => key === `node_modules/${name}` || key.endsWith(`/node_modules/${name}`));
        expect(items.some(([, value]) => value.version === version), `${name}@${version} missing in resolved graph`).toBe(true);
      }
      emit("package.json", outPkg);
      emit("package-lock.json", outLock);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });
}
